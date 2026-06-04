import { useState } from 'react';
import { 
  FileText, 
  Trash2, 
  Eye, 
  Sparkles, 
  FileWarning, 
  CheckCircle, 
  AlertTriangle,
  FolderOpen,
  Calendar,
  Layers,
  Activity
} from 'lucide-react';
import { generateSampleDocument, deleteDocument } from '../lib/api';

export default function DocumentList({ documents, loading, onRefresh, onViewDocument, onViewReport }) {
  const [generating, setGenerating] = useState(false);

  const handleCreateSample = async () => {
    setGenerating(true);
    try {
      await generateSampleDocument();
      onRefresh();
    } catch (err) {
      console.error(err);
      alert('Failed to generate sample document. Check console for details.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (window.confirm(`Are you sure you want to delete "${name}"? This will permanently delete the metadata and all processed pages.`)) {
      try {
        await deleteDocument(id);
        onRefresh();
      } catch (err) {
        console.error(err);
        alert('Failed to delete document.');
      }
    }
  };

  // Helper: Format bytes to KB/MB
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Calculations for Stats Card
  const totalDocs = documents.length;
  const totalPages = documents.reduce((sum, doc) => sum + (doc.totalPages || 0), 0);
  const totalWarnings = documents.reduce((sum, doc) => {
    let docWarnCount = doc.systemWarnings?.length || 0;
    doc.pages.forEach(p => {
      docWarnCount += p.warnings?.length || 0;
    });
    return sum + docWarnCount;
  }, 0);
  const cleanDocs = documents.filter(doc => {
    const pageWarns = doc.pages.reduce((sum, p) => sum + (p.warnings?.length || 0), 0);
    return (doc.systemWarnings?.length || 0) === 0 && pageWarns === 0;
  }).length;

  return (
    <div className="animate-fade-in">
      {/* Premium Statistics Grid */}
      <div className="metrics-grid">
        <div className="glass-card metric-card">
          <div className="metric-icon-wrapper" style={{ color: 'var(--primary)' }}>
            <FolderOpen size={22} />
          </div>
          <div className="metric-details">
            <h3>Documents Ingested</h3>
            <p>{totalDocs}</p>
          </div>
        </div>

        <div className="glass-card metric-card">
          <div className="metric-icon-wrapper" style={{ color: 'var(--secondary)' }}>
            <Layers size={22} />
          </div>
          <div className="metric-details">
            <h3>Total Pages</h3>
            <p>{totalPages}</p>
          </div>
        </div>

        <div className="glass-card metric-card warning">
          <div className="metric-icon-wrapper" style={{ color: 'var(--warning)' }}>
            <FileWarning size={22} />
          </div>
          <div className="metric-details">
            <h3>Active Warnings</h3>
            <p>{totalWarnings}</p>
          </div>
        </div>

        <div className="glass-card metric-card success">
          <div className="metric-icon-wrapper" style={{ color: 'var(--success)' }}>
            <CheckCircle size={22} />
          </div>
          <div className="metric-details">
            <h3>Fully Normalized</h3>
            <p>{cleanDocs} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>/ {totalDocs}</span></p>
          </div>
        </div>
      </div>

      {/* Main Table section */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2>Ingested Scans &amp; Answer Sheets</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Manage scanned sheets, review error reports, and normalise page rotations or dimensions.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button 
              type="button" 
              className="btn btn-secondary btn-sm" 
              onClick={onRefresh}
              disabled={loading}
            >
              <Activity size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button 
              type="button" 
              className="btn btn-primary btn-sm" 
              onClick={handleCreateSample}
              disabled={generating}
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--secondary))' }}
            >
              <Sparkles size={14} /> {generating ? 'Generating...' : 'Try Sample PDF'}
            </button>
          </div>
        </div>

        {loading && documents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 1rem' }}></div>
            Loading scanned sheets...
          </div>
        ) : documents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
            <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
            <h3>No documents uploaded yet</h3>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
              Upload your student answer sheet scans above, or click "Try Sample PDF" to instantly generate a demo file.
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateSample} disabled={generating}>
              <Sparkles size={14} /> Generate Demo Scan
            </button>
          </div>
        ) : (
          <div className="document-table-wrapper">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Uploaded At</th>
                  <th>File Size</th>
                  <th>Pages</th>
                  <th>Warnings</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  // Count total warnings on pages + system
                  let warnCount = doc.systemWarnings?.length || 0;
                  doc.pages.forEach(p => {
                    warnCount += p.warnings?.length || 0;
                  });

                  return (
                    <tr key={doc._id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <FileText size={18} style={{ color: 'var(--primary)' }} />
                          {doc.name}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                          <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                          {new Date(doc.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatBytes(doc.totalFileSize)}</td>
                      <td style={{ fontWeight: 500 }}>{doc.totalPages}</td>
                      <td>
                        {warnCount > 0 ? (
                          <span className="badge badge-warning" style={{ gap: '0.25rem' }}>
                            <AlertTriangle size={12} /> {warnCount} Warnings
                          </span>
                        ) : (
                          <span className="badge badge-success" style={{ gap: '0.25rem' }}>
                            <CheckCircle size={12} /> Clean
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${
                          doc.status === 'completed' ? 'badge-success' : 
                          doc.status === 'warning' ? 'badge-warning' : 
                          doc.status === 'failed' ? 'badge-danger' : 'badge-info'
                        }`}>
                          {doc.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button 
                            type="button" 
                            className="btn btn-secondary btn-sm"
                            title="Edit & Normalise Pages"
                            onClick={() => onViewDocument(doc._id)}
                            style={{ padding: '0.4rem 0.6rem' }}
                          >
                            <Eye size={14} /> Normalise
                          </button>
                          <button 
                            type="button" 
                            className="btn btn-secondary btn-sm"
                            title="View Processing Report"
                            onClick={() => onViewReport(doc._id)}
                            style={{ padding: '0.4rem 0.6rem', color: 'var(--secondary)' }}
                          >
                            Report
                          </button>
                          <button 
                            type="button" 
                            className="btn btn-danger btn-sm"
                            title="Delete Document"
                            onClick={() => handleDelete(doc._id, doc.name)}
                            style={{ padding: '0.4rem 0.6rem' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
