import { useState, useEffect } from 'react';
import { Layers, Sparkles, AlertCircle } from 'lucide-react';
import UploadZone from './components/UploadZone';
import DocumentList from './components/DocumentList';
import NormalizedViewer from './components/NormalizedViewer';
import ProcessingReport from './components/ProcessingReport';
import { getDocuments } from './lib/api';

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard', 'editor', 'report'
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch documents list from MERN backend
  const fetchDocuments = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getDocuments();
      setDocuments(data);
    } catch (err) {
      console.error(err);
      setError('Connection refused. Ensure the backend server and MongoDB are running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleOpenEditor = (docId) => {
    setSelectedDocId(docId);
    setView('editor');
  };

  const handleOpenReport = (docId) => {
    setSelectedDocId(docId);
    setView('report');
  };

  const handleBackToDashboard = () => {
    setView('dashboard');
    setSelectedDocId(null);
    fetchDocuments(); // Refresh to catch changes
  };

  return (
    <div className="app-container">
      {/* Premium Application Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">
            <Layers size={22} />
          </div>
          <div>
            <h1 className="app-title">PDF Page Normalisation Hub</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              MERN Evaluation Scan Pipeline
            </span>
          </div>
        </div>
        
        <div className="nav-links">
          <button 
            type="button" 
            className={`btn btn-sm ${view === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handleBackToDashboard}
            style={view === 'dashboard' ? { background: 'linear-gradient(135deg, var(--primary), var(--secondary))' } : {}}
          >
            Dashboard
          </button>
          {selectedDocId && (
            <>
              <button 
                type="button" 
                className={`btn btn-sm ${view === 'editor' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setView('editor')}
                style={view === 'editor' ? { background: 'linear-gradient(135deg, var(--primary), var(--secondary))' } : {}}
              >
                Normalisation Workspace
              </button>
              <button 
                type="button" 
                className={`btn btn-sm ${view === 'report' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setView('report')}
                style={view === 'report' ? { background: 'linear-gradient(135deg, var(--primary), var(--secondary))' } : {}}
              >
                Pipeline Report
              </button>
            </>
          )}
        </div>
      </header>

      {/* Global Error Banner */}
      {error && (
        <div className="glass-card animate-fade-in" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', padding: '1rem' }}>
          <AlertCircle size={20} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            <strong>Server Connectivity Issue:</strong> {error}
          </div>
        </div>
      )}

      {/* Main View Router */}
      <main style={{ minHeight: 'calc(100vh - 200px)' }}>
        {view === 'dashboard' && (
          <>
            <UploadZone onUploadSuccess={fetchDocuments} />
            <DocumentList 
              documents={documents} 
              loading={loading}
              onRefresh={fetchDocuments}
              onViewDocument={handleOpenEditor}
              onViewReport={handleOpenReport}
            />
          </>
        )}

        {view === 'editor' && selectedDocId && (
          <NormalizedViewer 
            documentId={selectedDocId} 
            onBack={handleBackToDashboard}
          />
        )}

        {view === 'report' && selectedDocId && (
          <ProcessingReport 
            documentId={selectedDocId} 
            onBack={handleBackToDashboard}
            onOpenEditor={() => handleOpenEditor(selectedDocId)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
