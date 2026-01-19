import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
  const [modals, setModals] = useState({
    addCamera: false,
    timelapseSettings: false,
    manageBackends: false,
    history: false,
    staff: false,
    subscription: false,
    settings: false,
    profile: false,
    handover: false,
    sidebar: false, // Sidebar visibility
  });

  const openModal = useCallback((modalName) => {
    setModals((prev) => ({ ...prev, [modalName]: true }));
  }, []);

  const closeModal = useCallback((modalName) => {
    setModals((prev) => ({ ...prev, [modalName]: false }));
  }, []);

  const toggleModal = useCallback((modalName) => {
    setModals((prev) => ({ ...prev, [modalName]: !prev[modalName] }));
  }, []);

  const value = useMemo(() => ({
    modals,
    openModal,
    closeModal,
    toggleModal
  }), [modals, openModal, closeModal, toggleModal]);

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
};

export default UIContext;
