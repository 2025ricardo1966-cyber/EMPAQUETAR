import { useEffect, useState } from 'react';
import { hashToPath, pathToHash } from '../../foundation/router';

export function useHashPath(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = useState(() => hashToPath(typeof window !== 'undefined' ? window.location.hash : '/'));
  useEffect(() => {
    const sync = () => setPath(hashToPath(window.location.hash));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const navigate = (to: string) => {
    window.location.hash = pathToHash(to);
  };
  return { path, navigate };
}
