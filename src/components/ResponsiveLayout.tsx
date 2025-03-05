import React from 'react';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  useTheme,
  Tooltip,
  Container,
  useScrollTrigger,
} from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import GitHubIcon from '@mui/icons-material/GitHub';
import { useThemeMode } from './ThemeModeProvider';

interface Props {
  children: React.ReactNode;
}

// For AppBar elevation scroll behavior
function ElevationScroll(props: { children: React.ReactElement }) {
  const { children } = props;
  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
  });

  return React.cloneElement(children, {
    elevation: trigger ? 4 : 0,
  });
}

const ResponsiveLayout: React.FC<Props> = ({ children }) => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const isDarkMode = mode === 'dark';

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      minHeight: '100vh',
      bgcolor: theme.palette.background.default,
      transition: theme.transitions.create('background-color'),
    }}>
      <ElevationScroll>
        <AppBar 
          position="sticky" 
          color="default" 
          sx={{
            borderBottom: `1px solid ${theme.palette.divider}`,
            backdropFilter: 'blur(8px)',
            backgroundColor: isDarkMode 
              ? 'rgba(30, 30, 30, 0.8)' 
              : 'rgba(255, 255, 255, 0.85)',
          }}
        >
          <Toolbar>
            <Typography 
              variant="h6" 
              component="div" 
              sx={{ flexGrow: 1, fontWeight: 600 }}
            >
              Team Randomizer
            </Typography>
            
            <Tooltip title="Toggle dark mode">
              <IconButton onClick={toggleMode} color="inherit" aria-label="toggle theme">
                {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="View on GitHub">
              <IconButton 
                color="inherit" 
                aria-label="github"
                href="https://github.com/Cabeda/team-Randomizer" 
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitHubIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
      </ElevationScroll>
      
      <Box 
        component="main" 
        sx={{ 
          flexGrow: 1, 
          width: '100%',
          pb: 4,
        }}
      >
        {children}
      </Box>
      
      <Box 
        component="footer" 
        sx={{ 
          py: 3, 
          px: 2, 
          mt: 'auto',
          backgroundColor: theme.palette.background.paper,
          borderTop: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Container maxWidth="sm">
          <Typography variant="body2" color="text.secondary" align="center">
            © {new Date().getFullYear()} Team Randomizer
          </Typography>
        </Container>
      </Box>
    </Box>
  );
};

export default ResponsiveLayout;
