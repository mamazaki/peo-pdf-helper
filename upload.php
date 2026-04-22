<?php
// ตั้งค่า Header ให้ตอบกลับเป็น JSON
header('Content-Type: application/json; charset=utf-8');

// ฟังก์ชัน Ghostscript ที่น้ำใสให้ไปก่อนหน้านี้
function compressPDF($inputFilePath, $outputFilePath) {
    if (!file_exists($inputFilePath)) return ['status' => false, 'message' => 'ไม่พบไฟล์ต้นฉบับ'];
    
    // ตั้งค่า -dPDFSETTINGS=/ebook (150 dpi)
    $gsPath = 'gs'; 
    $command = sprintf(
        '%s -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=%s %s',
        $gsPath, escapeshellarg($outputFilePath), escapeshellarg($inputFilePath)
    );

    exec($command, $output, $returnVar);

    if ($returnVar === 0 && file_exists($outputFilePath)) {
        return [
            'status' => true,
            'message' => 'บีบอัดสำเร็จแบบสมบูรณ์แบบค่ะ!',
            'old_size_kb' => number_format(filesize($inputFilePath) / 1024, 2),
            'new_size_kb' => number_format(filesize($outputFilePath) / 1024, 2)
        ];
    } else {
        return ['status' => false, 'message' => 'รัน Ghostscript ไม่ผ่าน (Error Code: ' . $returnVar . ')'];
    }
}

// ---------------------------------------------------------
// Process Upload
// ---------------------------------------------------------

// น้ำใสจับผิดอีกเรื่อง! อย่าลืมสร้างโฟลเดอร์นี้ที่ฝั่ง Server แล้วให้สิทธิ์ (chmod 775/777) นะคะ
$uploadDir = __DIR__ . '/uploads/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// เช็กว่ามีการส่งไฟล์มาไหม หรือติด Error จากฝั่ง PHP ไหม
if (!isset($_FILES['pdf_file']) || $_FILES['pdf_file']['error'] !== UPLOAD_ERR_OK) {
    echo json_encode([
        'status' => false, 
        'message' => 'อัปโหลดไม่สำเร็จค่ะ เช็กการตั้งค่า upload_max_filesize ใน php.ini ดูนะคะ'
    ]);
    exit;
}

$fileTmpPath = $_FILES['pdf_file']['tmp_name'];
$fileName = $_FILES['pdf_file']['name'];
$fileExtension = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));

// ดักไฟล์ประเภทอื่น
if ($fileExtension !== 'pdf') {
    echo json_encode(['status' => false, 'message' => 'รับเฉพาะไฟล์ PDF เท่านั้นค่ะพี่เมย์!']);
    exit;
}

// สร้างชื่อไฟล์ใหม่กันชื่อซ้ำ
$uniqueName = uniqid('pdf_') . '_' . time();
$inputFilePath = $uploadDir . 'original_' . $uniqueName . '.pdf';
$outputFilePath = $uploadDir . 'compressed_' . $uniqueName . '.pdf';

// ย้ายไฟล์จาก Temp ไปยังโฟลเดอร์ uploads
if (move_uploaded_file($fileTmpPath, $inputFilePath)) {
    
    // เรียกฟังก์ชันบีบอัด
    $result = compressPDF($inputFilePath, $outputFilePath);
    
    if ($result['status']) {
        // เพิ่ม URL สำหรับให้ User กดดาวน์โหลด
        // (สมมติว่าโฟลเดอร์ uploads อยู่ระดับเดียวกับ upload.php)
        $result['download_url'] = 'uploads/compressed_' . $uniqueName . '.pdf';
        
        // ลบไฟล์ต้นฉบับทิ้งเพื่อประหยัดพื้นที่ Hosting (วิศวกรที่ดีต้องไม่ทิ้งขยะไว้นะคะ)
        @unlink($inputFilePath);
        
        echo json_encode($result);
    } else {
        // ถ้าบีบอัดพัง ก็ลบไฟล์ original ทิ้งด้วย
        @unlink($inputFilePath);
        echo json_encode($result);
    }

} else {
    echo json_encode(['status' => false, 'message' => 'ย้ายไฟล์ไม่สำเร็จค่ะ เช็ก Permission ของโฟลเดอร์ uploads ด่วนเลย!']);
}
?>