(function (global) {
    'use strict';

    const VERSION = '1.7.1';
    const _scriptSrc = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
        ? document.currentScript.src
        : '';
    let _baseUrl = _scriptSrc ? _scriptSrc.replace(/\/core\/peo-pdf-core\.js(?:\?.*)?$/i, '/') : '';

    function getDeps(options = {}) {
        const pdfLib = options.PDFLib || global.PDFLib;
        const fk = options.fontkit || global.fontkit;
        if (!pdfLib) {
            throw new Error('PeoPdfCore requires PDFLib to be loaded first.');
        }
        return { PDFLib: pdfLib, fontkit: fk };
    }

    function configure(opts = {}) {
        if (typeof opts.baseUrl === 'string') {
            _baseUrl = opts.baseUrl ? (opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/') : '';
        }
    }

    function resolveFontUrl(fontFileName, customBaseUrl) {
        const base = typeof customBaseUrl === 'string' && customBaseUrl
            ? (customBaseUrl.endsWith('/') ? customBaseUrl : customBaseUrl + '/')
            : _baseUrl;
        return (base || '') + 'fonts/' + fontFileName;
    }

    async function loadFontBytes(fontFileName, options = {}) {
        if (typeof options.fontLoader === 'function') {
            return await options.fontLoader(fontFileName);
        }
        const url = resolveFontUrl(fontFileName, options.baseUrl);
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`ไม่พบไฟล์ฟอนต์ ${fontFileName} ในระบบ (Error ${res.status})`);
        }
        return await res.arrayBuffer();
    }

    function toThaiNum(str) {
        return String(str).replace(/\d/g, d => '๐๑๒๓๔๕๖๗๘๙'[d]);
    }

    function toArabicNum(str) {
        return String(str).replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d));
    }

    function formatDigits(str, useThai = false) {
        return useThai ? toThaiNum(toArabicNum(str)) : toArabicNum(str);
    }

    function getFormattedNumberText(num, total, type, format) {
        let str = num.toString();
        let strTotal = total.toString();
        if (type === 'thai') {
            str = num.toString().replace(/\d/g, d => '๐๑๒๓๔๕๖๗๘๙'[d]);
            strTotal = total.toString().replace(/\d/g, d => '๐๑๒๓๔๕๖๗๘๙'[d]);
        } else if (type === 'thai-alpha') {
            const alphabet = 'กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสฬอฮ';
            str = alphabet[(num - 1) % alphabet.length];
            strTotal = alphabet[(total - 1) % alphabet.length];
        }
        return (format || '{n}').replace('{n}', str).replace('{total}', strTotal);
    }

    function parsePageRange(str, max) {
        const parts = String(str || '').split(/[,;\s]+/);
        const set = new Set();
        for (const part of parts) {
            if (!part) continue;
            if (part.includes('-')) {
                const [startStr, endStr] = part.split('-');
                const s = parseInt(startStr, 10);
                const e = parseInt(endStr, 10);
                if (!isNaN(s) && !isNaN(e)) {
                    for (let i = Math.min(s, e); i <= Math.max(s, e); i++) {
                        if (i >= 1 && i <= max) set.add(i - 1);
                    }
                }
            } else {
                const n = parseInt(part, 10);
                if (!isNaN(n) && n >= 1 && n <= max) set.add(n - 1);
            }
        }
        return Array.from(set).sort((a, b) => a - b);
    }

    function clearPdfMetadata(pdfDoc) {
        pdfDoc.setTitle('');
        pdfDoc.setAuthor('');
        pdfDoc.setSubject('');
        pdfDoc.setKeywords([]);
        pdfDoc.setProducer('');
        pdfDoc.setCreator('');
    }

    function mapVisualPointToRaw(vx, vy, box, totalRot) {
        if (totalRot === 90) return { x: box.x + box.width - vy, y: box.y + vx };
        if (totalRot === 180) return { x: box.x + box.width - vx, y: box.y + box.height - vy };
        if (totalRot === 270) return { x: box.x + vy, y: box.y + box.height - vx };
        return { x: box.x + vx, y: box.y + vy };
    }

    function mapVisualRectToRaw(bx, by, bw, bh, box, totalRot) {
        if (totalRot === 90) return { x: box.x + box.width - by - bh, y: box.y + bx, width: bh, height: bw };
        if (totalRot === 180) return { x: box.x + box.width - bx - bw, y: box.y + box.height - by - bh, width: bw, height: bh };
        if (totalRot === 270) return { x: box.x + by, y: box.y + box.height - bx - bw, width: bh, height: bw };
        return { x: box.x + bx, y: box.y + by, width: bw, height: bh };
    }

    function calculatePageNumbers(pagePrintFlags = [], options = {}) {
        const startNum = Math.max(1, parseInt(options.startNum, 10) || 1);
        const startSheet = Math.max(1, parseInt(options.startSheet, 10) || 1);
        const skipUnprinted = !!options.skipUnprinted;
        const useSections = !!options.useSections;
        const globalType = options.globalType || 'thai';
        const globalFormat = options.globalFormat || '{n}';

        if (!useSections) {
            const numbers = [];
            const shouldPrintFlags = [];
            let cur = startNum;
            let printableTotal = 0;
            let activeTotal = 0;

            for (let i = 0; i < pagePrintFlags.length; i++) {
                const sheetNo = i + 1;
                const cardPrint = !!pagePrintFlags[i];
                if (sheetNo < startSheet) {
                    numbers.push(cur);
                    shouldPrintFlags.push(false);
                    continue;
                }
                activeTotal++;
                if (cardPrint) {
                    numbers.push(cur);
                    shouldPrintFlags.push(true);
                    cur++;
                    printableTotal++;
                } else {
                    numbers.push(cur);
                    shouldPrintFlags.push(false);
                    if (!skipUnprinted) cur++;
                }
            }
            const total = skipUnprinted ? Math.max(printableTotal, 1) : Math.max(activeTotal, 1);
            const perPage = pagePrintFlags.map((_, i) => ({
                shouldPrint: shouldPrintFlags[i],
                num: numbers[i],
                total: total,
                type: globalType,
                format: globalFormat
            }));
            return { numbers, total, perPage };
        }

        const rawRules = Array.isArray(options.rules) ? options.rules.slice() : [];
        const rules = rawRules
            .map(r => ({
                startPage: Math.max(1, parseInt(r.startPage, 10) || 1),
                type: r.type || 'thai',
                format: r.format || '{n}',
                startNum: Math.max(1, parseInt(r.startNum, 10) || 1)
            }))
            .sort((a, b) => a.startPage - b.startPage);

        if (!rules.length) {
            rules.push({ startPage: 1, type: globalType, format: globalFormat, startNum });
        }

        const matchedRulePerCard = pagePrintFlags.map((_, i) => {
            const p = i + 1;
            let matched = rules[0];
            for (const r of rules) {
                if (r.startPage <= p) matched = r;
                else break;
            }
            return matched;
        });

        const sectionState = new Map();
        const perPage = pagePrintFlags.map((flag, i) => {
            const rule = matchedRulePerCard[i];
            if (!sectionState.has(rule)) {
                sectionState.set(rule, { cur: rule.startNum, allCount: 0, printableCount: 0 });
            }
            const st = sectionState.get(rule);
            const isPrint = !!flag;
            const assignedNum = st.cur;
            st.allCount++;
            if (isPrint) {
                st.printableCount++;
                st.cur++;
            } else if (!skipUnprinted) {
                st.cur++;
            }
            return { rule, num: assignedNum, shouldPrint: isPrint };
        });

        const finalPerPage = perPage.map(entry => {
            const st = sectionState.get(entry.rule);
            const secTotal = skipUnprinted ? Math.max(st.printableCount, 1) : Math.max(st.allCount, 1);
            return {
                shouldPrint: entry.shouldPrint,
                num: entry.num,
                total: secTotal,
                type: entry.rule.type,
                format: entry.rule.format
            };
        });

        const numbers = finalPerPage.map(p => p.num);
        const total = Math.max(pagePrintFlags.length, 1);
        return { numbers, total, perPage: finalPerPage };
    }

    function getJpegExifOrientation(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength < 12 || view.getUint16(0, false) !== 0xFFD8) return 1;
        let offset = 2;
        while (offset + 4 < view.byteLength) {
            const marker = view.getUint16(offset, false);
            offset += 2;
            if (marker === 0xFFE1) {
                if (view.getUint32(offset + 2, false) !== 0x45786966) break;
                const little = view.getUint16(offset + 8, false) === 0x4949;
                const tiffStart = offset + 8;
                const firstIfd = view.getUint32(tiffStart + 4, little);
                const dirStart = tiffStart + firstIfd;
                if (dirStart + 2 > view.byteLength) break;
                const entries = view.getUint16(dirStart, little);
                for (let i = 0; i < entries; i++) {
                    const entryOffset = dirStart + 2 + i * 12;
                    if (entryOffset + 12 > view.byteLength) break;
                    if (view.getUint16(entryOffset, little) === 0x0112) {
                        return view.getUint16(entryOffset + 8, little);
                    }
                }
                break;
            } else if ((marker & 0xFF00) !== 0xFF00) {
                break;
            } else {
                offset += view.getUint16(offset, false);
            }
        }
        return 1;
    }

    async function loadDrawableImage(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
                return { drawable: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
            } catch (_) {
                // Fallback to <img> if imageOrientation option or format fails
            }
        }
        const objectUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้'));
                el.src = objectUrl;
            });
            return {
                drawable: img,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                cleanup: () => URL.revokeObjectURL(objectUrl)
            };
        } catch (err) {
            URL.revokeObjectURL(objectUrl);
            throw err;
        }
    }

    async function normalizeImageForPdf(file) {
        const lowerName = (file.name || '').toLowerCase();
        const isJpeg = file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(lowerName);
        const preferPng = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif' || /\.(png|webp|gif)$/i.test(lowerName);

        if (isJpeg && file.size <= 12 * 1024 * 1024) {
            const rawBytes = new Uint8Array(await file.arrayBuffer());
            if (getJpegExifOrientation(rawBytes.buffer) === 1) {
                return { bytes: rawBytes, isPng: false, passthrough: true };
            }
        }

        const targetMime = preferPng ? 'image/png' : 'image/jpeg';
        const loaded = await loadDrawableImage(file);
        try {
            const MAX_DIM = 2480;
            const { width, height } = loaded;
            const scale = Math.min(1, MAX_DIM / Math.max(width, height));
            const outW = Math.max(1, Math.round(width * scale));
            const outH = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            if (!preferPng) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, outW, outH);
            }
            ctx.drawImage(loaded.drawable, 0, 0, outW, outH);

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('แปลงไฟล์รูปภาพไม่สำเร็จ')), targetMime, 0.92);
            });
            return { bytes: new Uint8Array(await blob.arrayBuffer()), isPng: preferPng, passthrough: false };
        } finally {
            loaded.cleanup();
        }
    }

    async function imageFileToPdfBytes(file, options = {}) {
        const { PDFLib } = getDeps(options);
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.create();
        const norm = await normalizeImageForPdf(file);

        let embeddedImg;
        try {
            embeddedImg = norm.isPng
                ? await doc.embedPng(norm.bytes)
                : await doc.embedJpg(norm.bytes);
        } catch (err) {
            if (norm.passthrough) {
                const fallbackLoaded = await loadDrawableImage(file);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(2480, fallbackLoaded.width);
                    canvas.height = Math.round(fallbackLoaded.height * (canvas.width / fallbackLoaded.width));
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(fallbackLoaded.drawable, 0, 0, canvas.width, canvas.height);
                    const blob = await new Promise((resolve, reject) => {
                        canvas.toBlob(b => b ? resolve(b) : reject(new Error('แปลงไฟล์รูปภาพไม่สำเร็จ')), 'image/jpeg', 0.92);
                    });
                    embeddedImg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
                } finally {
                    fallbackLoaded.cleanup();
                }
            } else {
                throw err;
            }
        }

        const pageW = options.pageW || 595.28;
        const pageH = options.pageH || 841.89;
        const margin = typeof options.margin === 'number' ? options.margin : 20;
        const page = doc.addPage([pageW, pageH]);

        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const scale = Math.min(maxW / embeddedImg.width, maxH / embeddedImg.height, 1);
        const w = embeddedImg.width * scale;
        const h = embeddedImg.height * scale;
        const x = (pageW - w) / 2;
        const y = (pageH - h) / 2;

        page.drawImage(embeddedImg, { x, y, width: w, height: h });
        return await doc.save();
    }

    function parseColorToRgb(colorInput, rgb) {
        if (!colorInput || typeof colorInput !== 'string') return rgb(0, 0, 0);
        const clean = colorInput.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(clean)) {
            const r = parseInt(clean.slice(0, 2), 16) / 255;
            const g = parseInt(clean.slice(2, 4), 16) / 255;
            const b = parseInt(clean.slice(4, 6), 16) / 255;
            return rgb(r, g, b);
        }
        if (/^[0-9a-fA-F]{3}$/.test(clean)) {
            const r = parseInt(clean[0] + clean[0], 16) / 255;
            const g = parseInt(clean[1] + clean[1], 16) / 255;
            const b = parseInt(clean[2] + clean[2], 16) / 255;
            return rgb(r, g, b);
        }
        return rgb(0, 0, 0);
    }

    async function createBlankPagePdfBytes(options = {}) {
        const { PDFLib, fontkit } = getDeps(options);
        const { PDFDocument, rgb } = PDFLib;
        const blankDoc = await PDFDocument.create();
        const pageW = options.pageW || 595.28;
        const pageH = options.pageH || 841.89;
        const blankPage = blankDoc.addPage([pageW, pageH]);
        const customText = options.customText || '';

        if (customText) {
            if (!fontkit) {
                throw new Error('PeoPdfCore requires fontkit for rendering Thai text.');
            }
            blankDoc.registerFontkit(fontkit);
            const fontStyleFile = options.fontStyleFile || 'THSARABUNNEW.TTF';
            let fontBytes;
            try {
                fontBytes = await loadFontBytes(fontStyleFile, options);
            } catch (_) {
                fontBytes = await loadFontBytes('THSARABUNNEW.TTF', options);
            }

            const font = await blankDoc.embedFont(fontBytes, { subset: true });
            const fontSize = Math.max(8, Math.min(120, parseInt(options.fontSize, 10) || 20));
            const textColor = parseColorToRgb(options.textColor || '#000000', rgb);
            const maxWidth = pageW - 80;
            const lineHeight = fontSize * 1.4;

            const lines = [];
            for (const rawLine of customText.split(/\r?\n/)) {
                if (font.widthOfTextAtSize(rawLine, fontSize) <= maxWidth) {
                    lines.push(rawLine);
                } else {
                    let current = '';
                    for (const ch of rawLine) {
                        const test = current + ch;
                        if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
                            lines.push(current);
                            current = ch;
                        } else {
                            current = test;
                        }
                    }
                    if (current) lines.push(current);
                }
            }

            const totalBlockHeight = lines.length * lineHeight;
            const startY = (pageH + totalBlockHeight) / 2 - fontSize;
            lines.forEach((line, idx) => {
                if (!line) return;
                const tw = font.widthOfTextAtSize(line, fontSize);
                const x = (pageW - tw) / 2;
                const y = startY - idx * lineHeight;
                blankPage.drawText(line, { x, y, size: fontSize, font, color: textColor });
            });
        }

        return await blankDoc.save();
    }

    async function extractPagesPdfBytes(options = {}) {
        const { PDFLib } = getDeps(options);
        const { PDFDocument, degrees } = PDFLib;
        const pages = options.pages || [];
        const selectedIndices = options.selectedIndices || [];
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

        const finalPdf = await PDFDocument.create();
        const docCache = new Map();

        for (let k = 0; k < selectedIndices.length; k++) {
            if (isCancelled()) return null;
            if (onProgress) {
                onProgress(
                    Math.round(((k + 1) / selectedIndices.length) * 100),
                    `กำลังแยกหน้าที่ ${k + 1}/${selectedIndices.length}...`
                );
            }
            const idx = selectedIndices[k];
            const item = pages[idx];
            if (!item) continue;

            let src = docCache.get(item.pdfBytes);
            if (!src) {
                src = await PDFDocument.load(item.pdfBytes, { ignoreEncryption: true });
                docCache.set(item.pdfBytes, src);
            }
            const [page] = await finalPdf.copyPages(src, [item.originalIdx]);
            const rot = parseInt(item.rotation || 0, 10);
            const totalRot = (((page.getRotation().angle + rot) % 360) + 360) % 360;
            page.setRotation(degrees(totalRot));
            finalPdf.addPage(page);
        }

        if (isCancelled()) return null;

        if (options.cleanMetadata) {
            clearPdfMetadata(finalPdf);
        }

        return await finalPdf.save();
    }

    async function buildPdf(options = {}) {
        const { PDFLib, fontkit } = getDeps(options);
        const { PDFDocument, degrees, rgb, pushGraphicsState, popGraphicsState } = PDFLib;
        const pages = options.pages || [];
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

        const numbering = options.numbering || {};
        const stamp = options.stamp || {};
        const watermark = options.watermark || {};

        const isMasterEnabled = !!numbering.enabled;
        const stampEnabled = !!stamp.enabled;
        const wmEnabled = !!watermark.enabled;

        const finalPdf = await PDFDocument.create();
        const needsFonts = isMasterEnabled || stampEnabled || (wmEnabled && (watermark.text || '').trim());

        let font = null;
        let fontBold = null;

        if (needsFonts) {
            if (!fontkit) {
                throw new Error('PeoPdfCore requires fontkit to embed Thai Sarabun fonts.');
            }
            finalPdf.registerFontkit(fontkit);
            if (onProgress) onProgress(10, 'กำลังโหลดฟอนต์สารบรรณ...');

            const fontFileName = numbering.fontStyleFile || 'THSARABUNNEW.TTF';
            const fontBytes = await loadFontBytes(fontFileName, options);
            font = await finalPdf.embedFont(fontBytes, { subset: true });

            fontBold = font;
            try {
                const fbBytes = await loadFontBytes('THSARABUNNEWBOLD.TTF', options);
                fontBold = await finalPdf.embedFont(fbBytes, { subset: true });
            } catch (_) {
                fontBold = font;
            }
        }

        const posType = numbering.pos || 'TC';
        const fSize = Math.max(6, Math.min(72, parseInt(numbering.fontSize, 10) || 16));
        const startNum = Math.max(1, parseInt(numbering.startNum, 10) || 1);
        const ox = parseInt(numbering.offsetX, 10) || 0;
        const oy = parseInt(numbering.offsetY, 10) || 0;

        const perPage = Array.isArray(numbering.perPage)
            ? numbering.perPage
            : calculatePageNumbers(
                pages.map(p => (p.shouldPrint !== undefined ? !!p.shouldPrint : true)),
                {
                    startNum,
                    startSheet: numbering.startSheet || 1,
                    skipUnprinted: !!numbering.skipUnprinted,
                    useSections: !!numbering.useSections,
                    globalType: numbering.globalType || 'thai',
                    globalFormat: numbering.globalFormat || '{n}',
                    rules: numbering.rules || []
                }
            ).perPage;

        const stampUseThai = !!stamp.useThai;
        const stampDept = formatDigits(stamp.dept || 'สำนักงานศึกษาธิการจังหวัดอุดรธานี', stampUseThai);
        const stampNo = formatDigits(stamp.no || '', stampUseThai);
        const stampDate = formatDigits(stamp.date || '', stampUseThai);
        const stampTime = formatDigits(stamp.time || '', stampUseThai);
        const stampPageSetting = stamp.page || 'first';
        const stampPosSetting = stamp.pos || 'TR';

        const wmText = (watermark.text || '').trim();
        const wmSize = parseInt(watermark.size, 10) || 50;
        const wmAngleVal = parseInt(watermark.angle, 10) || 45;
        const wmColorType = watermark.color || 'red';
        let wmColorRgb = rgb(0.85, 0.2, 0.2);
        if (wmColorType === 'gray') wmColorRgb = rgb(0.5, 0.5, 0.5);
        else if (wmColorType === 'blue') wmColorRgb = rgb(0.1, 0.3, 0.8);

        const docCache = new Map();

        for (let i = 0; i < pages.length; i++) {
            if (isCancelled()) return null;
            if (onProgress) {
                const pct = 15 + Math.round(((i + 1) / pages.length) * 75);
                onProgress(pct, `กำลังรวมหน้าที่ ${i + 1} จาก ${pages.length}...`);
            }

            const item = pages[i];
            let src = docCache.get(item.pdfBytes);
            if (!src) {
                src = await PDFDocument.load(item.pdfBytes, { ignoreEncryption: true });
                docCache.set(item.pdfBytes, src);
            }

            const [page] = await finalPdf.copyPages(src, [item.originalIdx]);
            const rot = parseInt(item.rotation || 0, 10);
            const totalRot = (((page.getRotation().angle + rot) % 360) + 360) % 360;
            page.setRotation(degrees(totalRot));

            // Isolate any leftover CTM/graphics state in the source PDF page
            if (typeof page.node.normalize === 'function') page.node.normalize();
            const qStart = finalPdf.context.register(page.createContentStream(pushGraphicsState()));
            const qEnd = finalPdf.context.register(page.createContentStream(popGraphicsState()));
            page.node.wrapContentStreams(qStart, qEnd);

            const cropBox = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, ...page.getSize() };
            const { width, height } = cropBox;
            const vW = (totalRot === 90 || totalRot === 270) ? height : width;
            const vH = (totalRot === 90 || totalRot === 270) ? width : height;

            // 1) Watermark
            if (wmEnabled && wmText && fontBold) {
                const tw = fontBold.widthOfTextAtSize(wmText, wmSize);
                const rcx = cropBox.x + width / 2;
                const rcy = cropBox.y + height / 2;
                const theta = (wmAngleVal + totalRot) * Math.PI / 180;
                page.drawText(wmText, {
                    x: rcx - (tw / 2) * Math.cos(theta),
                    y: rcy - (tw / 2) * Math.sin(theta),
                    size: wmSize,
                    font: fontBold,
                    color: wmColorRgb,
                    opacity: 0.18,
                    rotate: degrees(wmAngleVal + totalRot)
                });
            }

            // 2) Page Numbering
            const cfg = perPage[i];
            if (isMasterEnabled && cfg && cfg.shouldPrint && font) {
                const text = getFormattedNumberText(cfg.num, cfg.total, cfg.type, cfg.format);
                const tw = font.widthOfTextAtSize(text, fSize);
                const margin = 40;
                let tx = 0;
                let ty = 0;
                if (posType === 'TR') { tx = vW - tw - margin + ox; ty = vH - margin - fSize + oy; }
                else if (posType === 'TC') { tx = (vW - tw) / 2 + ox; ty = vH - margin - fSize + oy; }
                else if (posType === 'BR') { tx = vW - tw - margin + ox; ty = margin + oy; }
                else if (posType === 'BC') { tx = (vW - tw) / 2 + ox; ty = margin + oy; }
                const pt = mapVisualPointToRaw(tx, ty, cropBox, totalRot);
                page.drawText(text, { x: pt.x, y: pt.y, size: fSize, font, rotate: degrees(totalRot) });
            }

            // 3) Official Receipt Stamp
            const shouldStamp = stampEnabled && (stampPageSetting === 'all' || i === 0);
            if (shouldStamp && font && fontBold) {
                const maxLineTw = Math.max(
                    fontBold.widthOfTextAtSize(stampDept, 12),
                    font.widthOfTextAtSize(`เลขรับ: ${stampNo || '........................'}`, 11),
                    font.widthOfTextAtSize(`วันที่: ${stampDate || '........................'}`, 11),
                    font.widthOfTextAtSize(`เวลา: ${stampTime || '........................'}`, 11)
                );
                const maxBoxW = Math.max(80, vW - 20);
                const boxW = Math.min(maxBoxW, Math.max(165, maxLineTw + 24));
                const boxH = 75;
                const marginEdge = Math.min(25, Math.max(8, (vW - boxW) / 2));
                const bx = (stampPosSetting === 'TR') ? (vW - boxW - marginEdge) : marginEdge;
                const by = vH - boxH - marginEdge;

                const rawRect = mapVisualRectToRaw(bx, by, boxW, boxH, cropBox, totalRot);
                page.drawRectangle({
                    x: rawRect.x,
                    y: rawRect.y,
                    width: rawRect.width,
                    height: rawRect.height,
                    borderWidth: 1.5,
                    borderColor: rgb(0.1, 0.25, 0.7)
                });

                const lines = [
                    { text: stampDept, size: 12, bold: true, offY: 58 },
                    { text: `เลขรับ: ${stampNo || '........................'}`, size: 11, bold: false, offY: 42 },
                    { text: `วันที่: ${stampDate || '........................'}`, size: 11, bold: false, offY: 26 },
                    { text: `เวลา: ${stampTime || '........................'}`, size: 11, bold: false, offY: 10 }
                ];

                for (const line of lines) {
                    const curFont = line.bold ? fontBold : font;
                    const lineTw = curFont.widthOfTextAtSize(line.text, line.size);
                    const lineX = line.bold ? (bx + (boxW - lineTw) / 2) : (bx + 8);
                    const lineY = by + line.offY;
                    const rawPt = mapVisualPointToRaw(lineX, lineY, cropBox, totalRot);

                    page.drawText(line.text, {
                        x: rawPt.x,
                        y: rawPt.y,
                        size: line.size,
                        font: curFont,
                        color: rgb(0.1, 0.25, 0.7),
                        rotate: degrees(totalRot)
                    });
                }
            }

            finalPdf.addPage(page);
        }

        if (isCancelled()) return null;

        if (options.cleanMetadata) {
            clearPdfMetadata(finalPdf);
        }

        if (onProgress) onProgress(95, 'กำลังสร้างไฟล์ PDF สำเร็จรูป...');
        return await finalPdf.save();
    }

    const PeoPdfCore = {
        VERSION,
        configure,
        resolveFontUrl,
        toThaiNum,
        toArabicNum,
        formatDigits,
        getFormattedNumberText,
        parsePageRange,
        clearPdfMetadata,
        mapVisualPointToRaw,
        mapVisualRectToRaw,
        calculatePageNumbers,
        getJpegExifOrientation,
        loadDrawableImage,
        normalizeImageForPdf,
        imageFileToPdfBytes,
        createBlankPagePdfBytes,
        extractPagesPdfBytes,
        buildPdf
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PeoPdfCore;
    }
    global.PeoPdfCore = PeoPdfCore;
})(typeof window !== 'undefined' ? window : globalThis);
