const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// Ensure upload directories exist
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PAGES_DIR = path.join(UPLOADS_DIR, 'pages');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(PAGES_DIR)) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
}

/**
 * Normalization Checks
 * - Landscape detection (width > height)
 * - Low resolution detection (dimensions less than 500px)
 * - Skew risk (often scans on mobile are slightly tilted, we can add a warning if it's an image or has certain properties)
 */
const runNormalizationChecks = (width, height, pageNum, originalRotation) => {
  const warnings = [];
  
  // 1. Landscape Orientation Check
  // In answer sheets, landscape layout is usually scanned wrong, or the page should be portrait
  // Note: if originalRotation is 90 or 270, it might mean the PDF viewer already compensates,
  // but if width > height and rotation is 0, it is physically landscape.
  const isLandscape = (width > height);
  if (isLandscape && (originalRotation === 0 || originalRotation === 180)) {
    warnings.push(`Page ${pageNum}: Landscape layout detected (width: ${Math.round(width)}pt, height: ${Math.round(height)}pt). Evaluators may need to rotate it to portrait.`);
  }

  // 2. Low Resolution / Dimension Check
  // Point values: 72 points per inch. A4 is 595 x 842 points.
  // If points are below 400, it's very low resolution (poor quality for reading hand-written texts)
  if (width < 450 || height < 450) {
    warnings.push(`Page ${pageNum}: Low resolution warning (${Math.round(width)}x${Math.round(height)}pt). Text might be blurry or illegible.`);
  }

  // 3. Aspect Ratio Deviation
  const aspectRatio = width / height;
  const standardA4Ratio = 595 / 842; // ~0.706
  const standardLetterRatio = 612 / 792; // ~0.773
  
  // If aspect ratio is heavily skewed (e.g. > 1.2 or < 0.4), it is non-standard
  if (aspectRatio > 1.4 || aspectRatio < 0.4) {
    warnings.push(`Page ${pageNum}: Non-standard aspect ratio (${aspectRatio.toFixed(2)}). Skewed or cropped scan.`);
  }

  return warnings;
};

/**
 * Ingests a PDF document from a file buffer
 */
const ingestPDF = async (fileBuffer, fileName, totalFileSize) => {
  try {
    const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
    
    // Check if encrypted
    if (pdfDoc.isEncrypted) {
      throw new Error('Encrypted PDFs are not supported. Please upload an unencrypted document.');
    }

    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    const documentId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const pageMetadataList = [];
    const documentWarnings = [];

    // Extract pages as individual PDFs
    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      
      const { width, height } = page.getSize();
      const aspectRatio = width / height;
      
      // Get rotation safely
      let originalRotation = 0;
      try {
        const rot = page.getRotation();
        originalRotation = rot.angle || 0;
      } catch (err) {
        originalRotation = 0;
      }

      // Run checks
      const pageWarnings = runNormalizationChecks(width, height, pageNum, originalRotation);
      if (pageWarnings.length > 0) {
        documentWarnings.push(...pageWarnings);
      }

      // Create a sub-document with just this page
      const subDoc = await PDFDocument.create();
      const [copiedPage] = await subDoc.copyPages(pdfDoc, [i]);
      subDoc.addPage(copiedPage);
      
      const subDocBytes = await subDoc.save();
      const pageFileName = `${documentId}_page_${pageNum}.pdf`;
      const pageFilePath = path.join(PAGES_DIR, pageFileName);
      
      fs.writeFileSync(pageFilePath, subDocBytes);

      pageMetadataList.push({
        pageNumber: pageNum,
        originalWidth: width,
        originalHeight: height,
        aspectRatio: aspectRatio,
        originalRotation: originalRotation,
        currentRotation: originalRotation, // Initial state matches original
        scale: 1.0,
        orderIndex: i, // 0-based initial index
        filePath: `/uploads/pages/${pageFileName}`,
        status: pageWarnings.length > 0 ? 'warning' : 'normal',
        warnings: pageWarnings,
        errors: []
      });
    }

    // Try reading PDF Metadata
    let pdfMeta = {};
    try {
      pdfMeta = {
        producer: pdfDoc.getProducer() || 'Unknown',
        creator: pdfDoc.getCreator() || 'Unknown',
        pdfVersion: pdfDoc.getVersion() || '1.4',
        creationDate: pdfDoc.getCreationDate() || new Date()
      };
    } catch (e) {
      pdfMeta = {
        producer: 'Unknown',
        creator: 'Unknown',
        pdfVersion: '1.4',
        creationDate: new Date()
      };
    }

    return {
      documentId,
      name: fileName,
      totalFileSize,
      totalPages,
      pages: pageMetadataList,
      systemWarnings: documentWarnings,
      systemErrors: [],
      metadata: pdfMeta,
      status: documentWarnings.length > 0 ? 'completed' : 'completed' // will use status completion
    };
  } catch (error) {
    console.error('Error during PDF ingestion:', error);
    throw error;
  }
};

/**
 * Ingests an image and wraps it inside a single-page PDF
 */
const ingestImage = async (fileBuffer, fileName, mimeType, totalFileSize) => {
  try {
    const pdfDoc = await PDFDocument.create();
    
    // Embed the image
    let embeddedImage;
    const isPng = mimeType === 'image/png';
    
    if (isPng) {
      embeddedImage = await pdfDoc.embedPng(fileBuffer);
    } else {
      embeddedImage = await pdfDoc.embedJpg(fileBuffer);
    }

    const { width, height } = embeddedImage.scale(1.0);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width,
      height
    });

    const pdfBytes = await pdfDoc.save();
    
    const documentId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const pageFileName = `${documentId}_page_1.pdf`;
    const pageFilePath = path.join(PAGES_DIR, pageFileName);
    
    fs.writeFileSync(pageFilePath, pdfBytes);

    const warnings = [];
    // If image dimension is really small
    if (width < 450 || height < 450) {
      warnings.push(`Page 1 (Image): Low resolution scan (${Math.round(width)}x${Math.round(height)}px). May contain blurry hand-writing.`);
    }
    // Images scanned sideways
    if (width > height) {
      warnings.push('Page 1 (Image): Landscape aspect ratio detected. Suggest rotating to portrait.');
    }

    const pageMeta = {
      pageNumber: 1,
      originalWidth: width,
      originalHeight: height,
      aspectRatio: width / height,
      originalRotation: 0,
      currentRotation: 0,
      scale: 1.0,
      orderIndex: 0,
      filePath: `/uploads/pages/${pageFileName}`,
      status: warnings.length > 0 ? 'warning' : 'normal',
      warnings: warnings,
      errors: []
    };

    return {
      documentId,
      name: fileName,
      totalFileSize,
      totalPages: 1,
      pages: [pageMeta],
      systemWarnings: warnings,
      systemErrors: [],
      metadata: {
        producer: 'PDF Evaluation App Image Wrapper',
        creator: 'MERN Ingestion Pipeline',
        pdfVersion: '1.4',
        creationDate: new Date()
      },
      status: 'completed'
    };
  } catch (error) {
    console.error('Error during image ingestion:', error);
    throw error;
  }
};

module.exports = {
  ingestPDF,
  ingestImage
};
