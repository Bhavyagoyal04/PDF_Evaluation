import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { uploadDocument } from '../lib/api';

export default function UploadZone({ onUploadSuccess }) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleChange = async (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      await handleUpload(e.target.files[0]);
    }
  };

  const handleUpload = async (file) => {
    const validExtensions = ['.pdf', '.png', '.jpg', '.jpeg'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!validExtensions.includes(fileExtension)) {
      setError('Invalid format. Please upload PDF, PNG, or JPG/JPEG scans.');
      setSuccess(false);
      return;
    }

    // Limit to 50MB
    if (file.size > 50 * 1024 * 1024) {
      setError('File size too large. Maximum size allowed is 50MB.');
      setSuccess(false);
      return;
    }

    setError('');
    setUploading(true);
    setProgress(0);
    setSuccess(false);

    try {
      await uploadDocument(file, (percent) => {
        setProgress(percent);
      });
      setSuccess(true);
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ingestion failed. Ensure MongoDB is running and file is healthy.');
    } finally {
      setUploading(false);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  return (
    <div className="glass-card animate-fade-in" style={{ marginBottom: '2rem' }}>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleChange}
      />
      
      <div 
        className={`upload-container ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
      >
        <div className="upload-icon">
          <Upload size={28} />
        </div>
        
        <h3>Drag &amp; Drop Answer Sheet Scan</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Supports PDF, PNG, JPG, or JPEG formats up to 50MB
        </p>
        
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }}>
          Browse Files
        </button>

        {uploading && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={16} /> Ingesting and normalising pages... {progress}%
            </span>
            <div className="progress-bar-container">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}

        {success && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', marginTop: '0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>
            <CheckCircle2 size={16} /> Ingestion &amp; page extraction completed!
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', marginTop: '0.75rem', fontSize: '0.875rem', fontWeight: 500 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}
      </div>
    </div>
  );
}
