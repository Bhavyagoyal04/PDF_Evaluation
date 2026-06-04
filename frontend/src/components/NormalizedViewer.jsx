import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { 
  RotateCw, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  ChevronUp, 
  ChevronDown, 
  Save, 
  RotateCcw as ResetIcon, 
  AlertTriangle,
  ArrowLeft,
  Download,
  LayoutGrid,
  Columns2,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { getDocument, updatePageMetadata, getDocumentPDFUrl, downloadNormalizedPDF } from '../lib/api';

// Worker must match the installed pdfjs-dist version (v6), not a CDN copy
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function NormalizedViewer({ documentId, onBack }) {
  const [doc, setDoc] = useState(null);
  const [pages, setPages] = useState([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState('');
  
  const [viewMode, setViewMode] = useState('split'); // 'split' or 'grid'
  const [selectedPages, setSelectedPages] = useState([]); // array of page ids for batch actions
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  // Load document metadata
  useEffect(() => {
    if (!documentId) return;

    let active = true;
    const loadDocDetails = async () => {
      setLoading(true);
      try {
        const data = await getDocument(documentId);
        if (active) {
          setDoc(data);
          // Sort pages by orderIndex initially
          const sortedPages = [...data.pages].sort((a, b) => a.orderIndex - b.orderIndex);
          setPages(sortedPages);
          setSelectedPageIndex(0);
        }
      } catch (err) {
        console.error(err);
        if (active) {
          setError('Failed to fetch document page information.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDocDetails();

    return () => {
      active = false;
    };
  }, [documentId]);

  // Render selected page to canvas when pages, selection, scale, or loading state changes
  useEffect(() => {
    if (loading || pages.length === 0 || selectedPageIndex >= pages.length) return;

    let cancelled = false;

    const renderPage = async () => {
      // Canvas mounts only after the loading spinner unmounts
      if (!canvasRef.current) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (cancelled || !canvasRef.current) return;
      }

      setPdfLoading(true);
      const currentPage = pages[selectedPageIndex];
      const pdfUrl = getDocumentPDFUrl(currentPage.filePath);

      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const pdfPage = await pdf.getPage(1);
        if (cancelled || !canvasRef.current) return;

        const currentScale = scale * (currentPage.scale || 1.0);
        // Apply evaluator rotation on top of the PDF's intrinsic page rotation
        const evaluatorDelta =
          (currentPage.currentRotation || 0) - (currentPage.originalRotation || 0);
        const viewport = pdfPage.getViewport({
          scale: currentScale,
          rotation: pdfPage.rotate + evaluatorDelta,
        });

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!cancelled) {
          renderTaskRef.current = null;
          setError('');
        }
      } catch (err) {
        if (!cancelled && err.name !== 'RenderingCancelledException') {
          console.error('PDF rendering error:', err);
          setError('Failed to render preview. Check file compatibility.');
        }
      } finally {
        if (!cancelled) {
          setPdfLoading(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pages, selectedPageIndex, scale, loading]);

  // Rotate functions
  const handleRotate = (direction) => {
    if (pages.length === 0) return;
    
    setPages(prev => {
      const updated = [...prev];
      const page = { ...updated[selectedPageIndex] };
      
      let newRotation = (page.currentRotation || 0) + (direction === 'cw' ? 90 : -90);
      // Keep rotation within 0, 90, 180, 270 range
      if (newRotation >= 360) newRotation -= 360;
      if (newRotation < 0) newRotation += 360;
      
      page.currentRotation = newRotation;
      updated[selectedPageIndex] = page;
      return updated;
    });
  };

  // Zoom functions
  const handleZoom = (factor) => {
    setScale(prev => Math.min(Math.max(prev + factor, 0.4), 3.0));
  };

  const handleReset = () => {
    setScale(1.0);
    setPages(prev => {
      const updated = [...prev];
      const page = { ...updated[selectedPageIndex] };
      page.currentRotation = page.originalRotation || 0;
      page.scale = 1.0;
      updated[selectedPageIndex] = page;
      return updated;
    });
  };

  // Reorder functions (Move up/down list)
  const handleMovePage = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === pages.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    setPages(prev => {
      const updated = [...prev];
      
      // Swap orderIndex values
      const tempOrder = updated[index].orderIndex;
      updated[index].orderIndex = updated[targetIndex].orderIndex;
      updated[targetIndex].orderIndex = tempOrder;

      // Swap items in local state array
      const tempItem = updated[index];
      updated[index] = updated[targetIndex];
      updated[targetIndex] = tempItem;

      return updated;
    });

    // Update active page index if it was moved
    if (selectedPageIndex === index) {
      setSelectedPageIndex(targetIndex);
    } else if (selectedPageIndex === targetIndex) {
      setSelectedPageIndex(index);
    }
  };

  // HTML5 Drag and Drop handlers
  const handleDragStart = (idx, e) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx);
  };

  const handleDragOver = (idx, e) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    setDragOverIdx(idx);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDrop = (targetIdx, e) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDragOverIdx(null);
      return;
    }

    setPages(prev => {
      const updated = [...prev];
      const draggedItem = updated[draggedIdx];
      
      updated.splice(draggedIdx, 1);
      updated.splice(targetIdx, 0, draggedItem);
      
      return updated.map((page, index) => ({
        ...page,
        orderIndex: index
      }));
    });

    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Multi-select / Batch Actions handlers
  const handleToggleSelectPage = (pageId, e) => {
    e.stopPropagation();
    setSelectedPages(prev => {
      if (prev.includes(pageId)) {
        return prev.filter(id => id !== pageId);
      } else {
        return [...prev, pageId];
      }
    });
  };

  const handleSelectAll = () => {
    setSelectedPages(pages.map(p => p._id));
  };

  const handleClearSelection = () => {
    setSelectedPages([]);
  };

  const handleBatchRotate = (direction) => {
    if (selectedPages.length === 0) return;
    setPages(prev =>
      prev.map(p => {
        if (selectedPages.includes(p._id)) {
          let newRotation = (p.currentRotation || 0) + (direction === 'cw' ? 90 : -90);
          if (newRotation >= 360) newRotation -= 360;
          if (newRotation < 0) newRotation += 360;
          return { ...p, currentRotation: newRotation };
        }
        return p;
      })
    );
  };

  const handleBatchReset = () => {
    if (selectedPages.length === 0) return;
    setPages(prev =>
      prev.map(p => {
        if (selectedPages.includes(p._id)) {
          return { ...p, currentRotation: p.originalRotation || 0, scale: 1.0 };
        }
        return p;
      })
    );
  };

  const handleBatchDelete = () => {
    if (selectedPages.length === 0) return;
    if (window.confirm(`Are you sure you want to delete the ${selectedPages.length} selected pages? This will temporarily remove them from the workspace. Click "Save Normalisation" to commit the deletion physically.`)) {
      setPages(prev => {
        const remaining = prev.filter(p => !selectedPages.includes(p._id));
        return remaining.map((p, idx) => ({ ...p, orderIndex: idx }));
      });
      setSelectedPages([]);
      setSelectedPageIndex(0);
    }
  };

  const handleDeletePage = (pageId, e) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this page? Click "Save Normalisation" to commit changes.')) {
      setPages(prev => {
        const remaining = prev.filter(p => p._id !== pageId);
        return remaining.map((p, idx) => ({ ...p, orderIndex: idx }));
      });
      setSelectedPages(prev => prev.filter(id => id !== pageId));
      setSelectedPageIndex(0);
    }
  };

  const handleExportPDF = () => {
    if (documentId) {
      downloadNormalizedPDF(documentId);
    }
  };

  // Save changes to backend
  const handleSaveChanges = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setError('');
    try {
      await updatePageMetadata(documentId, pages);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError('Failed to save changes back to MongoDB server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6rem' }}>
        <div className="loading-spinner" style={{ marginBottom: '1.5rem' }}></div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading document previews &amp; metadata...</p>
      </div>
    );
  }

  const selectedPage = pages[selectedPageIndex];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack} style={{ padding: '0.5rem' }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 style={{ fontSize: '1.25rem' }}>Page Normalisation Workspace</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{doc?.name}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Workspace Layout Toggle */}
          <div className="view-toggle-group">
            <button 
              type="button" 
              className={`view-toggle-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="Split View Editor"
            >
              <Columns2 size={14} /> Split View
            </button>
            <button 
              type="button" 
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid Workspace"
            >
              <LayoutGrid size={14} /> Grid View
            </button>
          </div>

          {saveSuccess && (
            <span style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 600 }}>
              Changes saved successfully!
            </span>
          )}
          {error && (
            <span style={{ fontSize: '0.85rem', color: 'var(--danger)', fontWeight: 500 }}>
              {error}
            </span>
          )}
          
          <button 
            type="button" 
            className="btn btn-secondary btn-sm" 
            onClick={handleExportPDF}
            title="Download Compiled & Rotated PDF"
            style={{ border: '1px solid var(--secondary)', color: '#c084fc' }}
          >
            <Download size={14} /> Export PDF
          </button>

          <button 
            type="button" 
            className="btn btn-primary btn-sm" 
            onClick={handleSaveChanges}
            disabled={saving}
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--secondary))' }}
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Normalisation'}
          </button>
        </div>
      </div>

      {pages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '6rem', color: 'var(--text-secondary)', border: '1px dashed var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={48} style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }} />
          <h3>All pages deleted from workspace</h3>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
            You have deleted all pages of this scan. Click "Save Normalisation" to commit this state or click Back.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
          {/* Grid Selection Actions Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(17, 25, 40, 0.5)', padding: '0.75rem 1.25rem', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: 'none' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleSelectAll}>
                Select All
              </button>
              <button 
                type="button" 
                className="btn btn-secondary btn-sm" 
                onClick={handleClearSelection}
                disabled={selectedPages.length === 0}
              >
                Clear Selection
              </button>
              <span style={{ width: '1px', height: '16px', background: 'var(--border-glass)', margin: '0 0.5rem' }}></span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--warning)', cursor: 'pointer', userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={showWarningsOnly} 
                  onChange={(e) => setShowWarningsOnly(e.target.checked)}
                  style={{ accentColor: 'var(--warning)', cursor: 'pointer' }}
                />
                Show Warnings Only ({pages.filter(p => p.warnings?.length > 0).length})
              </label>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Drag cards to reorder. Double click a card to view in editor mode.
            </span>
          </div>

          {/* Grid Container */}
          <div className="grid-workspace">
            {pages.map((page, idx) => {
              const hasWarnings = page.warnings?.length > 0;
              if (showWarningsOnly && !hasWarnings) return null;

              const isActive = selectedPageIndex === idx;
              const isSelected = selectedPages.includes(page._id);
              const isRotated = page.currentRotation !== 0;

              return (
                <div 
                  key={page._id || idx}
                  className={`grid-page-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${draggedIdx === idx ? 'dragging' : ''} ${dragOverIdx === idx ? 'drag-over' : ''}`}
                  onClick={() => setSelectedPageIndex(idx)}
                  onDoubleClick={() => {
                    setSelectedPageIndex(idx);
                    setViewMode('split');
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(idx, e)}
                  onDragOver={(e) => handleDragOver(idx, e)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(idx, e)}
                >
                  {/* Select Checkbox */}
                  <div className="card-checkbox-container" onClick={e => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      className="custom-checkbox"
                      checked={isSelected}
                      onChange={(e) => handleToggleSelectPage(page._id, e)}
                    />
                  </div>

                  <div className="grid-preview-holder" style={{ borderLeft: hasWarnings ? '3px solid var(--warning)' : '1px solid var(--border-glass)' }}>
                    {/* Visual placeholder inside card */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'rgba(255, 255, 255, 0.05)' }}>
                        P. {page.pageNumber}
                      </span>
                      {isRotated && (
                        <div className="badge badge-info" style={{ gap: '0.2rem', fontSize: '0.7rem' }}>
                          <RefreshCw size={10} /> {page.currentRotation}° Normalized
                        </div>
                      )}
                      {hasWarnings && (
                        <div className="badge badge-warning" style={{ gap: '0.2rem', fontSize: '0.7rem' }}>
                          <AlertTriangle size={10} /> Skew Check
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ width: '100%', fontSize: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, marginBottom: '0.15rem' }}>
                      <span>Page {page.pageNumber}</span>
                      <span style={{ color: 'var(--text-muted)' }}>Index: {idx + 1}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{Math.round(page.originalWidth)}x{Math.round(page.originalHeight)} pt</span>
                      
                      {/* Trash action for page */}
                      <button 
                        type="button" 
                        onClick={(e) => handleDeletePage(page._id, e)} 
                        title="Delete Page"
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.1rem' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Split view */
        <div className="viewer-layout">
          {/* Sidebar thumbnails */}
          <div className="glass-card viewer-sidebar">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div className="sidebar-title" style={{ marginBottom: 0 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Scan Pages ({pages.length})</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Click to Edit</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--warning)', cursor: 'pointer', userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={showWarningsOnly} 
                  onChange={(e) => setShowWarningsOnly(e.target.checked)}
                  style={{ accentColor: 'var(--warning)', cursor: 'pointer' }}
                />
                Filter: Warnings Only ({pages.filter(p => p.warnings?.length > 0).length})
              </label>
            </div>

            <div className="thumbnail-list">
              {pages.map((page, idx) => {
                const hasWarnings = page.warnings?.length > 0;
                if (showWarningsOnly && !hasWarnings) return null;

                const isActive = selectedPageIndex === idx;
                const isSelected = selectedPages.includes(page._id);
                const isRotated = page.currentRotation !== 0;

                return (
                  <div 
                    key={page._id || idx}
                    className={`thumbnail-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${draggedIdx === idx ? 'dragging' : ''} ${dragOverIdx === idx ? 'drag-over' : ''}`}
                    onClick={() => setSelectedPageIndex(idx)}
                    draggable
                    onDragStart={(e) => handleDragStart(idx, e)}
                    onDragOver={(e) => handleDragOver(idx, e)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(idx, e)}
                  >
                    {/* Checkbox selector */}
                    <div style={{ display: 'flex', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        className="custom-checkbox"
                        checked={isSelected}
                        onChange={(e) => handleToggleSelectPage(page._id, e)}
                      />
                    </div>

                    <div className="thumbnail-num">{idx + 1}</div>
                    
                    <div className="thumbnail-preview-holder">
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.25rem' }}>
                        P. {page.pageNumber}
                        {isRotated && (
                          <div style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '0.65rem', marginTop: '0.2rem' }}>
                            {page.currentRotation}°
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="thumbnail-info">
                      <div className="thumbnail-name">Page {page.pageNumber}</div>
                      <div className="thumbnail-size" style={{ fontSize: '0.7rem' }}>
                        {Math.round(page.originalWidth)}x{Math.round(page.originalHeight)}pt
                      </div>
                      {hasWarnings && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', color: 'var(--warning)', marginTop: '0.15rem', fontSize: '0.65rem', fontWeight: 600 }}>
                          <AlertTriangle size={10} /> Warning Flag
                        </div>
                      )}
                    </div>

                    {/* Reorder Controls */}
                    <div className="reorder-controls" onClick={e => e.stopPropagation()}>
                      <button 
                        type="button" 
                        className="btn-reorder" 
                        disabled={idx === 0} 
                        onClick={() => handleMovePage(idx, 'up')}
                        title="Move Page Up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button 
                        type="button" 
                        className="btn-reorder" 
                        disabled={idx === pages.length - 1} 
                        onClick={() => handleMovePage(idx, 'down')}
                        title="Move Page Down"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Work Arena */}
          <div className="viewer-workspace">
            <div className="viewer-toolbar">
              <div className="toolbar-group">
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Viewing Page {selectedPageIndex + 1} of {pages.length}
                </span>
                {selectedPage?.warnings?.length > 0 && (
                  <span className="badge badge-warning" style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', gap: '0.15rem' }}>
                    <AlertTriangle size={10} /> Check Warnings
                  </span>
                )}
              </div>

              <div className="toolbar-group">
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  onClick={() => handleRotate('ccw')}
                  title="Rotate 90° Counter-Clockwise"
                  style={{ padding: '0.4rem' }}
                >
                  <RotateCcw size={14} />
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  onClick={() => handleRotate('cw')}
                  title="Rotate 90° Clockwise"
                  style={{ padding: '0.4rem' }}
                >
                  <RotateCw size={14} />
                </button>
                <span style={{ width: '1px', height: '16px', background: 'var(--border-glass)' }}></span>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  onClick={() => handleZoom(-0.1)}
                  title="Zoom Out"
                  style={{ padding: '0.4rem' }}
                >
                  <ZoomOut size={14} />
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: '32px', textAlign: 'center' }}>
                  {Math.round(scale * 100)}%
                </span>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  onClick={() => handleZoom(0.1)}
                  title="Zoom In"
                  style={{ padding: '0.4rem' }}
                >
                  <ZoomIn size={14} />
                </button>
                <span style={{ width: '1px', height: '16px', background: 'var(--border-glass)' }}></span>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  onClick={handleReset}
                  title="Reset Rotation &amp; Scale"
                  style={{ padding: '0.4rem', color: 'var(--danger)' }}
                >
                  <ResetIcon size={14} /> Reset
                </button>
                <span style={{ width: '1px', height: '16px', background: 'var(--border-glass)' }}></span>
                <button 
                  type="button" 
                  className="btn btn-danger btn-sm" 
                  onClick={(e) => handleDeletePage(selectedPage?._id, e)}
                  title="Delete Page"
                  style={{ padding: '0.4rem' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="canvas-container">
              {pdfLoading && (
                <div style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(0,0,0,0.7)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', border: '1px solid var(--border-glass)', zIndex: 10 }}>
                  <span className="animate-spin" style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                  Rendering...
                </div>
              )}
              
              <div className="pdf-canvas-wrapper">
                <canvas ref={canvasRef} />
              </div>
            </div>
            
            {selectedPage?.warnings?.length > 0 && (
              <div className="glass-card" style={{ marginTop: '1rem', padding: '1rem', borderLeft: '3px solid var(--warning)', borderRadius: 'var(--radius-md)' }}>
                <h4 style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  <AlertTriangle size={14} /> Page Warnings Flags:
                </h4>
                <ul style={{ paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {selectedPage.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Batch Operations Toolbar */}
      <div className={`batch-toolbar ${selectedPages.length > 0 ? 'show' : ''}`}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="batch-count-badge">{selectedPages.length}</span> Pages Selected
        </span>
        <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)' }}></span>
        
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleBatchRotate('ccw')} title="Rotate Selected CCW">
          <RotateCcw size={14} /> CCW 90°
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleBatchRotate('cw')} title="Rotate Selected CW">
          <RotateCw size={14} /> CW 90°
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleBatchReset} title="Reset Selected to Original">
          <ResetIcon size={14} /> Reset
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={handleBatchDelete} title="Delete Selected Pages">
          <Trash2 size={14} /> Delete
        </button>
        
        <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)' }}></span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleClearSelection} style={{ fontSize: '0.75rem' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
