import React, { useState, useEffect } from 'react';
import { Home } from './pages/Home';
import { CreateRoom } from './pages/CreateRoom';
import { WatchRoom } from './pages/WatchRoom';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<string>('home');
  const [currentRoomId, setCurrentRoomId] = useState<string>('');

  const parseRoute = () => {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);

    const matchRoom = path.match(/^\/room\/([A-Za-z0-9_-]+)/);
    if (matchRoom) {
      setCurrentPage('room');
      setCurrentRoomId(matchRoom[1].toUpperCase());
    } else if (searchParams.get('room')) {
      setCurrentPage('room');
      setCurrentRoomId(searchParams.get('room')!.toUpperCase());
    } else if (path === '/create') {
      setCurrentPage('create');
    } else {
      setCurrentPage('home');
    }
  };

  useEffect(() => {
    parseRoute();
    window.addEventListener('popstate', parseRoute);
    return () => window.removeEventListener('popstate', parseRoute);
  }, []);

  const navigate = (page: string, params?: Record<string, string>) => {
    if (page === 'home') {
      window.history.pushState({}, '', '/');
      setCurrentPage('home');
      setCurrentRoomId('');
    } else if (page === 'create') {
      window.history.pushState({}, '', '/create');
      setCurrentPage('create');
      setCurrentRoomId('');
    } else if (page === 'room' && params?.roomId) {
      const code = params.roomId.toUpperCase();
      window.history.pushState({}, '', `/room/${code}`);
      setCurrentRoomId(code);
      setCurrentPage('room');
    }
  };

  if (currentPage === 'room' && currentRoomId) {
    return <WatchRoom roomId={currentRoomId} onNavigate={navigate} />;
  }

  if (currentPage === 'create') {
    return <CreateRoom onNavigate={navigate} />;
  }

  return <Home onNavigate={navigate} />;
};

export default App;
