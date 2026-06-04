
/**
 * Extract embedded images from a PDF buffer
 * Works by finding DCTDecode (JPEG) and FlateDecode (PNG/deflate) streams in the PDF
 */
const zlib = require('zlib');
const sharp = require('sharp');
const { promisify } = require('util');

const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);

/**
 * Find JPEG images embedded in a PDF buffer.
 * JPEG images in PDF are stored as raw DCT streams between 'stream' and 'endstream'.
 * JPEG magic bytes: FF D8 FF
 * @param {Buffer} pdfBuffer
 * @returns {Buffer[]} Array of JPEG image buffers
 */
function extractJpegImages(pdfBuffer) {
  const images = [];
  let searchStart = 0;
  
  while (searchStart < pdfBuffer.length) {
    // Find JPEG SOI marker: FF D8 FF
    const soiIdx = pdfBuffer.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), searchStart);
    if (soiIdx === -1) break;
    
    // Find JPEG EOI marker: FF D9
    const eoiIdx = pdfBuffer.indexOf(Buffer.from([0xFF, 0xD9]), soiIdx + 4);
    if (eoiIdx === -1) {
      searchStart = soiIdx + 4;
      continue;
    }
    
    const jpegBuffer = pdfBuffer.slice(soiIdx, eoiIdx + 2);
    
    // Only include reasonably sized images (> 1KB to filter out thumbnails)
    if (jpegBuffer.length > 1024) {
      images.push(jpegBuffer);
    }
    
    searchStart = eoiIdx + 2;
  }
  
  return images;
}

/**
 * Find PNG images embedded in a PDF buffer.
 * PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
 * @param {Buffer} pdfBuffer
 * @returns {Buffer[]} Array of PNG image buffers
 */
function extractPngImages(pdfBuffer) {
  const images = [];
  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  let searchStart = 0;
  
  while (searchStart < pdfBuffer.length) {
    const pngIdx = pdfBuffer.indexOf(pngMagic, searchStart);
    if (pngIdx === -1) break;
    
    // Find the IEND chunk (PNG end): 49 45 4E 44 AE 42 60 82
    const iendChunk = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
    const iendIdx = pdfBuffer.indexOf(iendChunk, pngIdx + 8);
    if (iendIdx === -1) {
      searchStart = pngIdx + 8;
      continue;
    }
    
    const pngBuffer = pdfBuffer.slice(pngIdx, iendIdx + 8);
    if (pngBuffer.length > 1024) {
      images.push(pngBuffer);
    }
    
    searchStart = iendIdx + 8;
  }
  
  return images;
}

/**
 * Extract all embeded images from a PDF buffer.
 * Returns the largest image found (most likely the scanned page content).
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Buffer|null>} Image buffer or null if no images found
 */
async function extractLargestEmbeddedImage(pdfBuffer) {
  const jpegs = extractJpegImages(pdfBuffer);
  const pngs = extractPngImages(pdfBuffer);
  
  const allImages = [
    ...jpegs.map(buf => ({ buf, type: 'jpeg' })),
    ...pngs.map(buf => ({ buf, type: 'png' }))
  ];
  
  if (allImages.length === 0) return null;
  
  // Return the largest image (most likely the page scan)
  allImages.sort((a, b) => b.buf.length - a.buf.length);
  
  // Validate it's actually a valid image
  try {
    const meta = await sharp(allImages[0].buf).metadata();
    if (meta.width && meta.height) {
      return allImages[0].buf;
    }
  } catch (err) {
    // Invalid image, try next
    for (let i = 1; i < allImages.length; i++) {
      try {
        const meta = await sharp(allImages[i].buf).metadata();
        if (meta.width && meta.height) return allImages[i].buf;
      } catch (e) { continue; }
    }
  }
  
  return null;
}

module.exports = { extractLargestEmbeddedImage, extractJpegImages, extractPngImages };
