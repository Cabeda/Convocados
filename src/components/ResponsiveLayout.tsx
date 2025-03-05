import React, { ReactNode } from 'react';
import { Box, Container, useTheme, useMediaQuery } from '@mui/material';

interface ResponsiveLayoutProps {
  children: ReactNode;
}

const ResponsiveLayout: React.FC<ResponsiveLayoutProps> = ({ children }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  return (
    <Box 
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: isMobile ? theme.spacing(2) : theme.spacing(4),
      }}
    >
      <Container 
        maxWidth="lg" 
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: isMobile ? theme.spacing(2) : theme.spacing(3),
        }}
      >
        {children}
      </Container>
    </Box>
  );
};

export default ResponsiveLayout;
