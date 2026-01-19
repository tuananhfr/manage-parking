/**
 * API Utility - Fetch wrapper with automatic Authorization header
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

/**
 * Fetch wrapper that automatically adds Authorization header
 * @param {string} url - API endpoint (relative or absolute)
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  
  // Build full URL if relative
  const fullUrl = url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
  
  // Merge headers with Authorization
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(fullUrl, {
    ...options,
    headers,
  });
}

/**
 * Helper to handle unauthorized responses (redirect to login)
 * @param {Response} response
 */
export function handleAuthError(response) {
  if (response.status === 401) {
    // Token expired or invalid
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
}

export default fetchWithAuth;
