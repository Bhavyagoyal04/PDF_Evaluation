import axios from 'axios';

const API_BASE = 'http://localhost:5001/api/documents';

export const getDocuments = async () => {
  const response = await axios.get(API_BASE);
  return response.data;
};

export const getDocument = async (id) => {
  const response = await axios.get(`${API_BASE}/${id}`);
  return response.data;
};

export const uploadDocument = async (file, onUploadProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await axios.post(`${API_BASE}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onUploadProgress && progressEvent.total) {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onUploadProgress(percentCompleted);
      }
    }
  });
  return response.data;
};

export const generateSampleDocument = async () => {
  const response = await axios.post(`${API_BASE}/sample`);
  return response.data;
};

export const updatePageMetadata = async (id, pages) => {
  const response = await axios.put(`${API_BASE}/${id}/pages`, { pages });
  return response.data;
};

export const deleteDocument = async (id) => {
  const response = await axios.delete(`${API_BASE}/${id}`);
  return response.data;
};

export const getDocumentPDFUrl = (filePath) => {
  return `http://localhost:5001${filePath}`;
};
