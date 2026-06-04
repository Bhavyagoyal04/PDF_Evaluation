
/**
 * PDF/Image Ingestion Service
 * 
 * Handles PDF and image file ingestion with:
 * - PDF page extraction (pdf-lib)
 * - Embedded image extraction for visual analysis
 * - Rotation detection via projection profile variance analysis
 * - Tilt/skew detection via Radon transform
 * - Crop/aspect ratio checks
 * - Low resolution checks
 */

const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { extractLargestEmbeddedImage } = require('./pdfImageExtractor');

// ── Upload Directories ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PAGES_DIR = path.join(UPLOADS_DIR, 'pages');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true });

// ── Projection Profile Analysis ────────────────────────────────────────────────

/**
 * Compute the horizontal projection profile of a binary/greyscale image.
 * Each row sum represents how much "ink" (dark pixels) is in that row.
 * High variance = strong text-line pattern = correct orientation.
 * 
 * @param {Buffer} pixels - Raw greyscale pixel buffer
 * @param {number} width
 * @param {number} height
 * @returns {number[]} Row sum profile
 */
function horizontalProjection(pixels, width, height) {
  const profile = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      // Invert: text is dark (low pixel value), background is light
      rowSum += 255 - pixels[rowStart + x];
    }
    profile[y] = rowSum;
  }
  return profile;
}

/**
 * Compute variance of an array.
 * High variance means clear row-by-row variation (text lines + whitespace).
 * @param {number[]} arr
 * @returns {number}
 */
function variance(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  const mean = sum / arr.length;
  let varSum = 0;
  for (const v of arr) varSum += (v - mean) ** 2;
  return varSum / arr.length;
}

/**
 * Rotate raw greyscale pixel data 90° clockwise.
 * @param {Buffer} pixels
 * @param {number} width
 * @param {number} height
 * @returns {{ pixels: Buffer, width: number, height: number }}
 */
function rotate90CW(pixels, width, height) {
  const newPixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      // After 90° CW: new position (height-1-y, x) 
      newPixels[x * height + (height - 1 - y)] = pixels[rowStart + x];
    }
  }
  return { pixels: newPixels, width: height, height: width };
}

// ── Rotation Detection ────────────────────────────────────────────────────────

/**
 * Detect the dominant rotation of a page image.
 *
 * Uses a two-stage approach:
 * 1. Portrait vs Landscape: Compare horizontal projection variances.
 *    Portrait (0° or 180°) has higher variance than landscape (90° or 270°).
 *    This is very reliable — text lines create strong horizontal patterns.
 * 2. 180° Upside-Down: Only if portrait is confirmed, compare top vs bottom
 *    content density. Headers/numbers typically appear at the top of answer sheets.
 *    Only flagged with strict thresholds to minimize false positives.
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<{rotationType: string, correctionAngle: number, confidence: number, variances: number[], bestIdx: number}>}
 */
async function detectPageRotation(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .resize({ width: 300, fit: 'inside' })
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let { width, height } = info;
  let pixels = data;
  const variances = [];

  for (let i = 0; i < 4; i++) {
    const profile = horizontalProjection(pixels, width, height);
    variances.push(variance(profile));
    const rotated = rotate90CW(pixels, width, height);
    pixels = rotated.pixels;
    width = rotated.width;
    height = rotated.height;
  }

  // Portrait-mode = indices 0 (0°) and 2 (180°) — text lines are horizontal
  // Landscape-mode = indices 1 (90°CW) and 3 (270°CW) — text lines are vertical
  const portraitVariance = Math.max(variances[0], variances[2]);
  const landscape90Variance = variances[1];
  const landscape270Variance = variances[3];
  const landscapeVariance = Math.max(landscape90Variance, landscape270Variance);

  const maxAll = Math.max(...variances);
  const minAll = Math.min(...variances);
  const overallConf = maxAll > 0 ? (maxAll - minAll) / maxAll : 0;

  // ── Stage 1: Portrait vs Landscape ──────────────────────────────────────────
  if (landscapeVariance > portraitVariance && overallConf > 0.005) {
    if (landscape90Variance >= landscape270Variance) {
      return { rotationType: 'landscape_cw', correctionAngle: 90, confidence: overallConf, variances, bestIdx: 1 };
    } else {
      return { rotationType: 'landscape_ccw', correctionAngle: 270, confidence: overallConf, variances, bestIdx: 3 };
    }
  }

  // ── Stage 2: 180° Upside-Down Check (top vs bottom content density) ──────────
  // Only reliable if there is significant content asymmetry between top and bottom
  const { data: rawData, info: rawInfo } = await sharp(imageBuffer)
    .greyscale()
    .resize({ width: 150, fit: 'inside' })
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rW = rawInfo.width, rH = rawInfo.height;
  const topEnd = Math.floor(rH * 0.30);       // top 30%
  const bottomStart = Math.floor(rH * 0.70);  // bottom 30%

  let topDark = 0, bottomDark = 0;
  for (let y = 0; y < topEnd; y++) {
    for (let x = 0; x < rW; x++) {
      if (rawData[y * rW + x] === 0) topDark++;
    }
  }
  for (let y = bottomStart; y < rH; y++) {
    for (let x = 0; x < rW; x++) {
      if (rawData[y * rW + x] === 0) bottomDark++;
    }
  }

  const totalDark = topDark + bottomDark;
  if (totalDark > 200) {
    const bottomFraction = bottomDark / totalDark;
    // Only flag as upside-down if bottom has 70%+ of content vs top
    // This is a very conservative threshold to avoid false positives
    if (bottomFraction > 0.70) {
      const flipConf = (bottomFraction - 0.5) * 2; // 0.4-1.0 range
      return { rotationType: 'upside_down', correctionAngle: 180, confidence: flipConf * 0.6, variances, bestIdx: 2 };
    }
  }

  // Correctly oriented
  return { rotationType: 'correct', correctionAngle: 0, confidence: overallConf, variances, bestIdx: 0 };
}

// ── Tilt/Skew Detection ────────────────────────────────────────────────────────

/**
 * Detect tilt/skew angle of a page using Radon transform projection analysis.
 * Checks small angles from -15° to +15° to find the angle with highest projection variance.
 * 
 * @param {Buffer} imageBuffer
 * @returns {Promise<{tiltAngle: number, confidence: number}>}
 */
async function detectPageTilt(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .resize({ width: 200, fit: 'inside' })
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = data;
  const cx = width / 2;
  const cy = height / 2;

  let bestAngle = 0;
  let bestVariance = -1;
  let zeroVariance = -1;

  // Check angles from -15 to +15 degrees in 0.5° steps
  for (let a = -15; a <= 15; a += 0.5) {
    const rad = (a * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const projectionBins = new Array(height + width).fill(0);

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x] === 0) { // Dark pixel (text)
          const dx = x - cx;
          // Project onto rotated horizontal axis
          const projY = Math.round(dx * sinA + dy * cosA + cy);
          const bin = projY + width; // offset to avoid negative indices
          if (bin >= 0 && bin < projectionBins.length) {
            projectionBins[bin]++;
          }
        }
      }
    }

    const v = variance(projectionBins);
    if (v > bestVariance) {
      bestVariance = v;
      bestAngle = a;
    }
    if (a === 0) {
      zeroVariance = v;
    }
  }

  // Confidence: improvement over 0° angle
  const confidence = zeroVariance > 0 ? Math.max(0, (bestVariance - zeroVariance) / zeroVariance) : 0;

  return { tiltAngle: bestAngle, confidence };
}

// ── Metadata Checks ────────────────────────────────────────────────────────────

/**
 * Run dimension/aspect-ratio checks on a page.
 * @param {number} width - page width (pts)
 * @param {number} height - page height (pts)
 * @param {number} pageNum
 * @returns {string[]}
 */
function runMetadataChecks(width, height, pageNum) {
  const warnings = [];

  // Low resolution check
  const maxDim = Math.max(width, height);
  if (maxDim < 350) {
    warnings.push(`Page ${pageNum}: Low resolution (${Math.round(width)}×${Math.round(height)} pt). Text may be blurry or illegible to evaluators.`);
  }

  // Crop / aspect ratio check
  const aspectRatio = width / height;
  if (width <= height) {
    // Portrait: Standard A4 ≈ 0.707, Letter ≈ 0.773
    if (aspectRatio < 0.60 || aspectRatio > 0.90) {
      warnings.push(`Page ${pageNum}: Non-standard portrait crop detected (aspect ratio: ${aspectRatio.toFixed(2)}). Expected 0.65–0.85 for A4/Letter. The page may be incorrectly trimmed.`);
    }
  } else {
    // Landscape: Standard A4 landscape ≈ 1.414
    if (aspectRatio < 1.10 || aspectRatio > 1.60) {
      warnings.push(`Page ${pageNum}: Non-standard landscape crop detected (aspect ratio: ${aspectRatio.toFixed(2)}). The page may be incorrectly trimmed.`);
    }
  }

  return warnings;
}

// ── Image Analysis (Rotation + Tilt) ─────────────────────────────────────────

/**
 * Run visual analysis checks on an extracted image.
 * Detects wrong rotation (90°/180°/270°) and tilt.
 * 
 * @param {Buffer} imageBuffer - JPEG or PNG image bytes
 * @param {number} pageNum
 * @param {number} pdfRotation - rotation stored in PDF metadata (for context)
 * @returns {Promise<string[]>}
 */
async function runImageAnalysisChecks(imageBuffer, pageNum, pdfRotation) {
  const warnings = [];

  try {
    // ── 1. Rotation Detection ──────────────────────────────────────────────────
    const { rotationType, correctionAngle, confidence, bestIdx } = await detectPageRotation(imageBuffer);

    if (rotationType !== 'correct' && confidence > 0.005) {
      let warningMsg = '';

      if (rotationType === 'landscape_cw') {
        warningMsg = `Page ${pageNum}: Incorrect page rotation detected — page is rotated 90° counter-clockwise ` +
          `(scan was placed sideways on the scanner, needs 90° clockwise correction). ` +
          `Please rotate to upright portrait orientation before evaluation.`;
      } else if (rotationType === 'landscape_ccw') {
        warningMsg = `Page ${pageNum}: Incorrect page rotation detected — page is rotated 90° clockwise ` +
          `(scan was placed sideways on the scanner, needs 90° counter-clockwise correction). ` +
          `Please rotate to upright portrait orientation before evaluation.`;
      } else if (rotationType === 'upside_down') {
        warningMsg = `Page ${pageNum}: Page appears to be upside-down (180° rotation detected). ` +
          `The scan content is inverted. Please flip the page to correct orientation before evaluation.`;
      }

      if (warningMsg) {
        warnings.push(warningMsg);
      }
    }

    // ── 2. Tilt/Skew Detection ─────────────────────────────────────────────────
    // Only check tilt when page is not severely misrotated
    if (rotationType === 'correct' || confidence <= 0.005) {
      const { tiltAngle, confidence: tiltConf } = await detectPageTilt(imageBuffer);

      // Flag tilt if angle > 3.0° and confidence > 0.5%
      if (Math.abs(tiltAngle) > 3.0 && tiltConf > 0.005) {
        const direction = tiltAngle > 0 ? 'clockwise' : 'counter-clockwise';
        warnings.push(
          `Page ${pageNum}: Page tilt/skew detected — the scanned content appears tilted ` +
          `approximately ${Math.abs(tiltAngle).toFixed(1)}° ${direction}. ` +
          `This suggests the page was placed at an angle on the scanner, which may affect readability.`
        );
      }
    }
  } catch (err) {
    console.warn(`[ingestionService] Visual analysis failed for page ${pageNum}:`, err.message);
    // Silent fail — don't add warnings for analysis errors
  }

  return warnings;
}

// ── PDF Ingestion ──────────────────────────────────────────────────────────────


/**
 * Ingests a PDF document from a file buffer.
 * Extracts each page, runs visual + metadata analysis, and returns structured metadata.
 * 
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {number} totalFileSize
 */
const ingestPDF = async (fileBuffer, fileName, totalFileSize) => {
  try {
    const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });

    if (pdfDoc.isEncrypted) {
      throw new Error('Encrypted PDFs are not supported. Please upload an unencrypted document.');
    }

    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    const documentId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const pageMetadataList = [];
    const documentWarnings = [];

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const pageNum = i + 1;

      const { width, height } = page.getSize();
      const aspectRatio = width / height;

      // Get rotation from PDF metadata
      let originalRotation = 0;
      try {
        const rot = page.getRotation();
        originalRotation = rot.angle || 0;
      } catch (_) {
        originalRotation = 0;
      }

      // Create a single-page sub-document for this page
      const subDoc = await PDFDocument.create();
      const [copiedPage] = await subDoc.copyPages(pdfDoc, [i]);
      subDoc.addPage(copiedPage);
      const subDocBytes = await subDoc.save();

      // Metadata-level checks (dimensions, aspect ratio)
      const metaWarnings = runMetadataChecks(width, height, pageNum);

      // Visual image analysis: extract embedded image from sub-doc and analyze
      let imageWarnings = [];
      try {
        const embeddedImage = await extractLargestEmbeddedImage(Buffer.from(subDocBytes));
        if (embeddedImage) {
          imageWarnings = await runImageAnalysisChecks(embeddedImage, pageNum, originalRotation);
        } else {
          // No embedded image found — page might be vector text or blank
          // In this case, check if PDF metadata rotation indicates an issue
          if (originalRotation === 90 || originalRotation === 270) {
            imageWarnings.push(
              `Page ${pageNum}: PDF metadata indicates the page is stored rotated at ${originalRotation}°. ` +
              `The page may display sideways in standard PDF viewers.`
            );
          } else if (originalRotation === 180) {
            imageWarnings.push(
              `Page ${pageNum}: PDF metadata indicates the page is stored upside-down (180° rotation). ` +
              `The page content will be displayed inverted.`
            );
          }
        }
      } catch (err) {
        console.warn(`[ingestPDF] Visual analysis skipped for page ${pageNum}:`, err.message);
      }

      const pageWarnings = [...metaWarnings, ...imageWarnings];

      // Save page file
      const pageFileName = `${documentId}_page_${pageNum}.pdf`;
      const pageFilePath = path.join(PAGES_DIR, pageFileName);
      fs.writeFileSync(pageFilePath, subDocBytes);

      pageMetadataList.push({
        pageNumber: pageNum,
        originalWidth: width,
        originalHeight: height,
        aspectRatio,
        originalRotation,
        currentRotation: originalRotation,
        scale: 1.0,
        orderIndex: i,
        filePath: `/uploads/pages/${pageFileName}`,
        status: pageWarnings.length > 0 ? 'warning' : 'normal',
        warnings: pageWarnings,
        errors: []
      });

      if (pageWarnings.length > 0) {
        documentWarnings.push(...pageWarnings);
      }
    }

    // PDF Metadata
    let pdfMeta = {};
    try {
      pdfMeta = {
        producer: pdfDoc.getProducer() || 'Unknown',
        creator: pdfDoc.getCreator() || 'Unknown',
        pdfVersion: pdfDoc.getVersion() || '1.4',
        creationDate: pdfDoc.getCreationDate() || new Date()
      };
    } catch (_) {
      pdfMeta = { producer: 'Unknown', creator: 'Unknown', pdfVersion: '1.4', creationDate: new Date() };
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
      status: 'completed'
    };
  } catch (error) {
    console.error('[ingestPDF] Error during PDF ingestion:', error);
    throw error;
  }
};

// ── Image Ingestion ────────────────────────────────────────────────────────────

/**
 * Ingests an image file and wraps it inside a single-page PDF.
 * Runs visual rotation/tilt analysis on the original image before wrapping.
 * 
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} mimeType
 * @param {number} totalFileSize
 */
const ingestImage = async (fileBuffer, fileName, mimeType, totalFileSize) => {
  try {
    const pdfDoc = await PDFDocument.create();

    let embeddedImage;
    const isPng = mimeType === 'image/png';
    if (isPng) {
      embeddedImage = await pdfDoc.embedPng(fileBuffer);
    } else {
      embeddedImage = await pdfDoc.embedJpg(fileBuffer);
    }

    const { width, height } = embeddedImage.scale(1.0);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embeddedImage, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();

    const documentId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const pageFileName = `${documentId}_page_1.pdf`;
    const pageFilePath = path.join(PAGES_DIR, pageFileName);
    fs.writeFileSync(pageFilePath, pdfBytes);

    const warnings = [];

    // Metadata checks
    const metaWarnings = runMetadataChecks(width, height, 1);
    warnings.push(...metaWarnings);

    // Landscape check
    if (width > height) {
      warnings.push(
        'Page 1 (Image): Landscape orientation detected. If this is a portrait answer sheet, ' +
        'the image may need to be rotated 90° before evaluation.'
      );
    }

    // Visual rotation/tilt analysis on the original image buffer
    try {
      const imageWarnings = await runImageAnalysisChecks(fileBuffer, 1, 0);
      warnings.push(...imageWarnings);
    } catch (err) {
      console.warn('[ingestImage] Image visual analysis failed:', err.message);
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
      warnings,
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
    console.error('[ingestImage] Error during image ingestion:', error);
    throw error;
  }
};

module.exports = { ingestPDF, ingestImage };
