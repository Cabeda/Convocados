import { useState, useEffect } from 'react';
import { compressToURL, decompressFromURL } from '../utils/urlCompression';

export interface Team {
  id: string;
  name: string;
  members: string[];
}

interface AppState {
  teams: Team[];
  players: string[];
}

interface TeamStateHook {
  teams: Team[];
  players: string[];
  setTeams: (teams: Team[]) => void;
  setPlayers: (players: string[]) => void;
  loading: boolean;
}

export function useTeamState(): TeamStateHook {
  const [teams, setTeamsInternal] = useState<Team[]>([]);
  const [players, setPlayersInternal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Load state from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    
    if (hash) {
      try {
        const decompressedState = decompressFromURL<AppState>(hash);
        if (decompressedState) {
          if (decompressedState.teams) {
            setTeamsInternal(decompressedState.teams);
          }
          if (decompressedState.players) {
            setPlayersInternal(decompressedState.players);
          }
        }
      } catch (error) {
        console.error('Failed to parse state from URL', error);
      }
    }
    
    // Handle popstate events (browser back/forward)
    const handlePopState = () => {
      const hash = window.location.hash.substring(1);
      if (hash) {
        try {
          const state = decompressFromURL<AppState>(hash);
          if (state) {
            if (state.teams) setTeamsInternal(state.teams);
            if (state.players) setPlayersInternal(state.players);
          }
        } catch (error) {
          console.error('Failed to parse state from URL during navigation', error);
        }
      } else {
        // Clear state if hash is empty
        setTeamsInternal([]);
        setPlayersInternal([]);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    setLoading(false);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
  
  // Update URL when state changes
  const updateUrlHash = (newTeams: Team[], newPlayers: string[]) => {
    const state: AppState = {
      teams: newTeams,
      players: newPlayers
    };
    
    const compressed = compressToURL(state);
    
    // Only update if we have something to share
    if (newTeams.length > 0 || newPlayers.length > 0) {
      window.location.hash = compressed;
    } else {
      window.location.hash = '';
    }
  };
  
  const setTeams = (newTeams: Team[]) => {
    setTeamsInternal(newTeams);
    updateUrlHash(newTeams, players);
  };
  
  const setPlayers = (newPlayers: string[]) => {
    setPlayersInternal(newPlayers);
    updateUrlHash(teams, newPlayers);
  };
  
  return { teams, players, setTeams, setPlayers, loading };
}
