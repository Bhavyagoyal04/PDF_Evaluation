const mongoose = require('mongoose');

const PageSchema = new mongoose.Schema({
  pageNumber: {
    type: Number,
    required: true
  },
  originalWidth: {
    type: Number,
    required: true
  },
  originalHeight: {
    type: Number,
    required: true
  },
  aspectRatio: {
    type: Number,
    required: true
  },
  originalRotation: {
    type: Number,
    default: 0 // 0, 90, 180, 270
  },
  currentRotation: {
    type: Number,
    default: 0 // rotated by evaluator (0, 90, 180, 270)
  },
  scale: {
    type: Number,
    default: 1.0 // scaled zoom/resolution factor by evaluator
  },
  orderIndex: {
    type: Number,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['normal', 'warning', 'failed'],
    default: 'normal'
  },
  warnings: [{
    type: String
  }],
  errors: [{
    type: String
  }]
});

const DocumentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  totalFileSize: {
    type: Number,
    required: true
  },
  totalPages: {
    type: Number,
    default: 0
  },
  pages: [PageSchema],
  systemWarnings: [{
    type: String
  }],
  systemErrors: [{
    type: String
  }],
  metadata: {
    producer: String,
    creator: String,
    pdfVersion: String,
    creationDate: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update standard updatedAt time before saving
DocumentSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Document', DocumentSchema);
