const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const Document = require('../models/Document');
const { ingestPDF, ingestImage } = require('../services/ingestionService');

// Multer memory storage configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * @route POST /api/documents/upload
 * @desc Upload PDF or image file and ingest it
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const extension = path.extname(originalname).toLowerCase();
    
    let docData;
    if (extension === '.pdf') {
      docData = await ingestPDF(buffer, originalname, size);
    } else if (['.png', '.jpg', '.jpeg'].includes(extension)) {
      docData = await ingestImage(buffer, originalname, mimetype, size);
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Please upload PDF, PNG, or JPG files.' });
    }

    // Save to DB
    const newDoc = new Document(docData);
    await newDoc.save();

    res.status(201).json(newDoc);
  } catch (error) {
    console.error('Upload API Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process document upload' });
  }
});

/**
 * @route POST /api/documents/sample
 * @desc Generate a programmatically skewed/mixed-size PDF and ingest it
 */
router.post('/sample', async (req, res) => {
  try {
    // Generate a PDF using pdf-lib
    const pdfDoc = await PDFDocument.create();
    
    // Page 1: Portrait Standard A4
    const page1 = pdfDoc.addPage([595, 842]);
    page1.drawText('ANSWER SHEET EVALUATION SYSTEM', { x: 50, y: 780, size: 24 });
    page1.drawText('DOCUMENT: MOCK EXAM PAPER', { x: 50, y: 740, size: 14 });
    page1.drawText('Page 1: Student Information (Portrait Orientation - Standard Size)', { x: 50, y: 700, size: 12 });
    page1.drawText('Status: Normal aspect ratio & resolution', { x: 50, y: 660, size: 11 });
    page1.drawRectangle({
      x: 50,
      y: 100,
      width: 495,
      height: 500,
      borderColor: rgb(0.2, 0.4, 0.8),
      borderWidth: 2,
    });
    page1.drawText('[Standard answer grid area mock]', { x: 180, y: 350, size: 16 });

    // Page 2: Landscape Standard A4 (Rotated!)
    // If we specify landscape size, let's say width: 842, height: 595
    const page2 = pdfDoc.addPage([842, 595]);
    page2.drawText('ANSWER SHEET EVALUATION SYSTEM', { x: 50, y: 530, size: 24 });
    page2.drawText('Page 2: Question Section (Landscape Layout - Rotated)', { x: 50, y: 490, size: 14 });
    page2.drawText('Status: LANDSCAPE detected! Evaluators will need to normalise/rotate this.', { x: 50, y: 450, size: 12 });
    page2.drawRectangle({
      x: 50,
      y: 50,
      width: 742,
      height: 350,
      borderColor: rgb(0.8, 0.4, 0.2),
      borderWidth: 2,
    });
    page2.drawText('[Landscape table layout mock]', { x: 280, y: 220, size: 16 });

    // Page 3: Small Square (Low Resolution Warning)
    const page3 = pdfDoc.addPage([300, 300]);
    page3.drawText('Page 3: Scanned Diagram', { x: 20, y: 260, size: 14 });
    page3.drawText('Warning: Low resolution (300x300 pt)!', { x: 20, y: 230, size: 11 });
    page3.drawRectangle({
      x: 20,
      y: 20,
      width: 260,
      height: 180,
      borderColor: rgb(0.8, 0.1, 0.1),
      borderWidth: 1.5,
    });
    page3.drawText('[Low-res signature/diagram]', { x: 60, y: 100, size: 12 });

    const pdfBytes = await pdfDoc.save();
    
    // Ingest the generated buffer
    const mockFilename = `sample_mixed_pages_${Date.now().toString().slice(-4)}.pdf`;
    const docData = await ingestPDF(Buffer.from(pdfBytes), mockFilename, pdfBytes.length);

    // Save to DB
    const newDoc = new Document(docData);
    await newDoc.save();

    res.status(201).json(newDoc);
  } catch (error) {
    console.error('Sample Generator Error:', error);
    res.status(500).json({ error: 'Failed to generate sample PDF' });
  }
});

/**
 * @route GET /api/documents
 * @desc Get all documents with warning metrics
 */
router.get('/', async (req, res) => {
  try {
    const docs = await Document.find().sort({ createdAt: -1 });
    res.json(docs);
  } catch (error) {
    console.error('Fetch Documents Error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * @route GET /api/documents/:id
 * @desc Get document details and page metadata
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc);
  } catch (error) {
    console.error('Fetch Document Error:', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

/**
 * @route PUT /api/documents/:id/pages
 * @desc Save normalized changes to pages metadata (rotations, scales, ordering)
 */
router.put('/:id/pages', async (req, res) => {
  try {
    const { pages } = req.body;
    if (!Array.isArray(pages)) {
      return res.status(400).json({ error: 'Pages array is required' });
    }

    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Identify deleted pages
    const requestPageIds = pages.map(p => p._id);
    const pagesToKeep = [];
    
    for (const pageSubdoc of doc.pages) {
      const pageIdStr = pageSubdoc._id.toString();
      if (requestPageIds.includes(pageIdStr)) {
        pagesToKeep.push(pageSubdoc);
      } else {
        // Delete physical file from filesystem
        const fullPath = path.join(__dirname, '..', pageSubdoc.filePath);
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch (err) {
            console.error(`Failed to delete page file: ${fullPath}`, err);
          }
        }
      }
    }
    
    // Assign filtered pages back
    doc.pages = pagesToKeep;

    // Update remaining pages
    pages.forEach(updatedPage => {
      const pageSubdoc = doc.pages.id(updatedPage._id);
      if (pageSubdoc) {
        pageSubdoc.currentRotation = updatedPage.currentRotation;
        pageSubdoc.scale = updatedPage.scale;
        pageSubdoc.orderIndex = updatedPage.orderIndex;
      }
    });

    // Sort the subdocuments in memory by orderIndex to keep them aligned
    doc.pages.sort((a, b) => a.orderIndex - b.orderIndex);
    
    // Update totalPages count
    doc.totalPages = doc.pages.length;

    await doc.save();
    res.json(doc);
  } catch (error) {
    console.error('Update Pages Error:', error);
    res.status(500).json({ error: 'Failed to update page metadata: ' + error.message });
  }
});

/**
 * @route GET /api/documents/:id/export
 * @desc Compile sorted pages and rotate them as per current settings into a single PDF, then trigger download
 */
router.get('/:id/export', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const mergedPdf = await PDFDocument.create();
    
    // Sort pages in order of their orderIndex
    const sortedPages = [...doc.pages].sort((a, b) => a.orderIndex - b.orderIndex);

    for (const pageMeta of sortedPages) {
      const fullPath = path.join(__dirname, '..', pageMeta.filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Page file not found: ${pageMeta.filePath}`);
      }

      const pageBytes = fs.readFileSync(fullPath);
      const pagePdf = await PDFDocument.load(pageBytes);
      const [copiedPage] = await mergedPdf.copyPages(pagePdf, [0]);
      
      // Apply the final normalized rotation (currentRotation)
      if (pageMeta.currentRotation !== undefined) {
        copiedPage.setRotation(degrees(pageMeta.currentRotation));
      }
      
      mergedPdf.addPage(copiedPage);
    }

    const pdfBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="normalized_${doc.name.replace(/[^a-zA-Z0-9.-]/g, '_')}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Export PDF Error:', error);
    res.status(500).json({ error: 'Failed to compile and export normalized PDF: ' + error.message });
  }
});

/**
 * @route DELETE /api/documents/:id
 * @desc Delete document and its pages from filesystem
 */
router.delete('/:id', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete all page files from filesystem
    doc.pages.forEach(page => {
      const fullPath = path.join(__dirname, '..', page.filePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error(`Failed to delete page file: ${fullPath}`, err);
        }
      }
    });

    await Document.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Document and processed pages deleted successfully' });
  } catch (error) {
    console.error('Delete Document Error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

module.exports = router;
