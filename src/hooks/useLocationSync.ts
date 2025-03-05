import { useEffect } from 'react';
import { useTeamState } from './useTeamState';

// Helper function to parse URL parameters
const parseUrlParams = () => {
  const params = new URLSearchParams(window.location.search);
  
  // Parse players from URL
  const playersParam = params.get('players');
  const players = playersParam ? playersParam.split(',').map(p => decodeURIComponent(p.trim())) : [];
  
  // Parse teams from URL if available
  const teamsParam = params.get('teams');
  let teams = [];
  if (teamsParam) {
    try {
      teams = JSON.parse(decodeURIComponent(teamsParam));
    } catch (error) {
      console.error('Failed to parse teams from URL', error);
    }
  }
  
  return { players, teams };
};

// Helper function to update URL with current state
const updateUrlParams = (players: string[], teams: any[]) => {
  const params = new URLSearchParams();
  
  // Add players to URL if any exist
  if (players.length > 0) {
    params.set('players', players.map(p => encodeURIComponent(p)).join(','));
  }
  
  // Add teams to URL if any exist
  if (teams.length > 0) {
    params.set('teams', encodeURIComponent(JSON.stringify(teams)));
  }
  
  // Update URL without reloading the page
  const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
  window.history.pushState({ players, teams }, '', newUrl);
};

// Hook to synchronize location with application state
export const useLocationSync = () => {
  const { teams, setTeams, loading } = useTeamState();
  
  // Initial state setup from URL
  useEffect(() => {
    if (loading) return;
    
    const { players, teams: urlTeams } = parseUrlParams();
    
    // Only update teams from URL if we don't already have teams loaded from storage
    if (urlTeams.length > 0 && teams.length === 0) {
      setTeams(urlTeams);
    }
    
    // Handle popstate event (browser back/forward navigation)
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.teams) {
        setTeams(event.state.teams);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [loading, setTeams, teams.length]);
  
  // Function to sync state to URL
  const syncToLocation = (players: string[], currentTeams = teams) => {
    updateUrlParams(players, currentTeams);
  };
  
  // Function to get initial players from URL
  const getInitialPlayers = (): string[] => {
    const { players } = parseUrlParams();
    return players;
  };
  
  return {
    syncToLocation,
    getInitialPlayers
  };
};
