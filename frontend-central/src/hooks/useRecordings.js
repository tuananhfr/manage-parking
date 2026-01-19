import { useState, useEffect, useMemo, useCallback } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
const PAGE_SIZE = 20;

const useRecordings = (selectedNvrId, selectedCameraId) => {
  const [recordings, setRecordings] = useState([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalRecordings, setTotalRecordings] = useState(0);

  // Filter states
  const [filterDate, setFilterDate] = useState("");
  const [filterStartTime, setFilterStartTime] = useState("");
  const [filterEndTime, setFilterEndTime] = useState("");

  const loadRecordings = useCallback(async (page = 1, append = false) => {
    if (!selectedNvrId || !selectedCameraId) return;

    // Ensure page is number
    const pageNum = typeof page === 'number' ? page : parseInt(page, 10) || 1;
    const cleanPage = pageNum < 1 ? 1 : pageNum;

    const isLoadingMore = append && cleanPage > 1;

    try {
      if (isLoadingMore) {
        setLoadingMore(true);
      } else {
        setLoadingRecordings(true);
        setError("");
      }

      let url = `${BACKEND_URL}/api/rtsp-cameras/recordings?nvr_id=${encodeURIComponent(
        selectedNvrId
      )}&camera_id=${encodeURIComponent(
        selectedCameraId
      )}&page=${cleanPage}&limit=${PAGE_SIZE}`;

      if (filterDate) url += `&date=${encodeURIComponent(filterDate)}`;
      if (filterStartTime) url += `&start_time=${encodeURIComponent(filterStartTime)}`;
      if (filterEndTime) url += `&end_time=${encodeURIComponent(filterEndTime)}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        const errData = await resp.json().catch(() => null);
        throw new Error(errData?.detail || `Failed to fetch recordings: ${resp.status}`);
      }

      const data = await resp.json();
      const list = Array.isArray(data.recordings) ? data.recordings : [];
      const pagination = data.pagination || {};

      setRecordings(prev => {
        if (append && cleanPage > 1) return [...prev, ...list];
        return list;
      });

      setCurrentPage(cleanPage);
      setHasMore(pagination.has_more || false);
      setTotalRecordings(pagination.total || list.length);

    } catch (e) {
      console.error("[useRecordings] Failed to load recordings", e);
      setError(e instanceof Error ? e.message : "Failed to load recordings");
    } finally {
      if (isLoadingMore) setLoadingMore(false);
      else setLoadingRecordings(false);
    }
  }, [selectedNvrId, selectedCameraId, filterDate, filterStartTime, filterEndTime]);

  const loadMoreRecordings = useCallback(() => {
    if (!loadingMore && hasMore && !loadingRecordings) {
      loadRecordings(currentPage + 1, true);
    }
  }, [loadingMore, hasMore, loadingRecordings, currentPage, loadRecordings]);

  // Initial load when selection or filters change
  useEffect(() => {
    if (selectedNvrId && selectedCameraId) {
       // Reset recordings immediately to avoid showing stale data while loading
       // But usually we want to keep showing until new data arrives? 
       // The original logic replaced it.
       loadRecordings(1, false);
    }
  }, [selectedNvrId, selectedCameraId, filterDate, filterStartTime, filterEndTime, loadRecordings]);

  // Client-side filtering logic (memoized)
  const filteredRecordings = useMemo(() => {
    // If we have server-side filtering (which the URL params suggest), client-side might be redundant 
    // BUT the original code did BOTH URL params AND client-side filtering. 
    // I will preserve the original logic for safety, although it might be double filtering.
    // Actually, looking at original code:
    // It builds URL with filter params.
    // AND it has `filteredRecordings` useMemo.
    // This seems to imply the backend might not be fully trusted or the user wants instant local filter if they loaded all?
    // Wait, if backend supports filtering, we should rely on it.
    // However, the original code had a complex parsing logic in useMemo.
    // Let's keep it to be safe, but optimize it.
    
    if (!filterDate && !filterStartTime && !filterEndTime) {
      return recordings;
    }

    return recordings.filter((rec) => {
      if (!rec.start) return false;
      try {
        const [recDateStr, recTimeStr] = rec.start.split("T");
        if (!recDateStr) return false;

        if (filterDate && recDateStr !== filterDate) return false;

        if (filterStartTime || filterEndTime) {
          if (!recTimeStr) return false;
          const recTime = recTimeStr.slice(0, 5);
          if (filterStartTime && recTime < filterStartTime) return false;
          if (filterEndTime && recTime > filterEndTime) return false;
        }
        return true;
      } catch (e) {
        return false;
      }
    });
  }, [recordings, filterDate, filterStartTime, filterEndTime]);

  return {
    recordings: filteredRecordings,
    totalRecordings, // or recordings.length if filtered
    loading: loadingRecordings,
    loadingMore,
    error,
    hasMore,
    filters: { date: filterDate, startTime: filterStartTime, endTime: filterEndTime },
    setFilters: { setDate: setFilterDate, setStartTime: setFilterStartTime, setEndTime: setFilterEndTime },
    loadRecordings,
    loadMoreRecordings
  };
};

export default useRecordings;
