import { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  Sliders, 
  Info,
  Clock
} from 'lucide-react';
import { getDocument } from '../lib/api';

export default function ProcessingReport({ documentId, onBack, onOpenEditor }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDoc = async () => {
      setLoading(true);
      try {
        const data = await getDocument(documentId);
        setDoc(data);
      } catch (err) {
        console.error(err);
        setError('Failed to fetch document processing report.');
      } finally {
        setLoading(false);
      }
    };
    if (documentId) {
      fetchDoc();
    }
  }, [documentId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6rem' }}>
        <div className="loading-spinner" style={{ marginBottom: '1.5rem' }}></div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading processing metrics &amp; logs...</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--danger)' }}>
        <AlertTriangle size={48} style={{ marginBottom: '1rem' }} />
        <h3>Error loading report</h3>
        <p style={{ marginTop: '0.5rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>{error || 'Document not found.'}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Count page warnings
  const pageWarnings = [];
  doc.pages.forEach(p => {
    if (p.warnings && p.warnings.length > 0) {
      pageWarnings.push({
        pageNumber: p.pageNumber,
        warnings: p.warnings
      });
    }
  });

  const totalWarnings = (doc.systemWarnings?.length || 0) + pageWarnings.reduce((sum, item) => sum + item.warnings.length, 0);

  return (
    <div className="animate-fade-in">
      {/* Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack} style={{ padding: '0.5rem' }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 style={{ fontSize: '1.25rem' }}>Ingestion &amp; Processing Report</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Review document structure, skew errors, and warning logs.</p>
          </div>
        </div>

        <button 
          type="button" 
          className="btn btn-secondary btn-sm" 
          onClick={onOpenEditor}
          style={{ border: '1px solid var(--primary)', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Sliders size={14} /> Adjust Normalisation
        </button>
      </div>

      <div className="report-grid">
        {/* Left Column: Warnings and logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Status summary banner */}
          <div className="glass-card" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1.5rem', 
            borderLeft: totalWarnings > 0 ? '4px solid var(--warning)' : '4px solid var(--success)',
            padding: '1.5rem' 
          }}>
            <div style={{ 
              width: '56px', 
              height: '56px', 
              borderRadius: '50%', 
              background: totalWarnings > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', 
              color: totalWarnings > 0 ? 'var(--warning)' : 'var(--success)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center'
            }}>
              {totalWarnings > 0 ? <AlertTriangle size={28} /> : <CheckCircle2 size={28} />}
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.2rem' }}>
                {totalWarnings > 0 ? `${totalWarnings} Processing Warnings Flagged` : 'Pipeline Processing Successful'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                {totalWarnings > 0 
                  ? 'The automated normalization pipeline detected page rotation or size variances. Review details below.' 
                  : 'All pages meet evaluation resolution criteria. Aspect ratio and page alignment are clean.'}
              </p>
            </div>
          </div>

          {/* Details list of warnings */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={18} style={{ color: 'var(--warning)' }} /> Page Warnings &amp; Quality Logs
            </h3>

            {totalWarnings === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)' }}>
                <CheckCircle2 size={36} style={{ color: 'var(--success)', marginBottom: '0.75rem' }} />
                <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>This document is fully healthy.</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>No alignment problems, landscape orientation, or skew errors were detected.</p>
              </div>
            ) : (
              <div>
                {/* System Warnings */}
                {doc.systemWarnings?.map((warn, idx) => (
                  <div key={idx} className="warning-item">
                    <AlertTriangle size={18} style={{ color: 'var(--warning)', marginTop: '0.1rem', flexShrink: 0 }} />
                    <div className="warning-text">
                      <h4>System Core warning</h4>
                      <p>{warn}</p>
                    </div>
                  </div>
                ))}

                {/* Page Warnings */}
                {pageWarnings.map((item) => (
                  <div key={item.pageNumber} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="thumbnail-num" style={{ width: '20px', height: '20px', fontSize: '0.7rem' }}>{item.pageNumber}</span>
                      Page {item.pageNumber} Flags
                    </div>
                    {item.warnings.map((warn, wIdx) => (
                      <div key={wIdx} className="warning-item" style={{ margin: '0.25rem 0' }}>
                        <AlertTriangle size={16} style={{ color: 'var(--warning)', marginTop: '0.1rem', flexShrink: 0 }} />
                        <div className="warning-text">
                          <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{warn}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Ingestion metadata and timeline logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Document metadata info card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Info size={18} style={{ color: 'var(--primary)' }} /> Scan Metadata
            </h3>
            
            <div className="metadata-list">
              <div className="metadata-row">
                <span className="metadata-label">File Name</span>
                <span className="metadata-value" style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.name}
                </span>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">Pages Extracted</span>
                <span className="metadata-value">{doc.totalPages}</span>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">PDF Standard Version</span>
                <span className="metadata-value">{doc.metadata?.pdfVersion || '1.4'}</span>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">Software Producer</span>
                <span className="metadata-value" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.metadata?.producer || 'Unknown'}
                </span>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">Software Creator</span>
                <span className="metadata-value" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.metadata?.creator || 'Unknown'}
                </span>
              </div>
              <div className="metadata-row" style={{ borderBottom: 'none' }}>
                <span className="metadata-label">Ingested Time</span>
                <span className="metadata-value" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Clock size={12} />
                  {new Date(doc.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>

          {/* Execution Pipeline Log Timeline */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={18} style={{ color: 'var(--secondary)' }} /> Ingestion Execution Timeline
            </h3>

            <div className="timeline">
              <div className="timeline-step success">
                <div className="timeline-dot"></div>
                <div className="timeline-title">Upload Completed</div>
                <div className="timeline-desc">Received stream: {(doc.totalFileSize / 1024 / 1024).toFixed(2)} MB buffer written to memory.</div>
              </div>

              <div className="timeline-step success">
                <div className="timeline-dot"></div>
                <div className="timeline-title">Page Extraction Pipeline</div>
                <div className="timeline-desc">Extracted {doc.totalPages} physical pages. Split PDF binaries successfully.</div>
              </div>

              <div className="timeline-step success">
                <div className="timeline-dot"></div>
                <div className="timeline-title">Normalization Scanning</div>
                <div className="timeline-desc">Analyzed page rotations, low resolution checks, and aspect ratios.</div>
              </div>

              <div className="timeline-step success">
                <div className="timeline-dot"></div>
                <div className="timeline-title">Pre-views Cached</div>
                <div className="timeline-desc">Generated {doc.totalPages} single-page preview files on Local uploads disk.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
