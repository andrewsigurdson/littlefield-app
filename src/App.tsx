import { Routes, Route } from 'react-router-dom';
import { LittlefieldProvider } from './context/LittlefieldContext';
import LittlefieldAnalysis from './pages/AnalysisPage';

function App() {
  return (
    <LittlefieldProvider>
      <Routes>
        <Route path="/" element={<LittlefieldAnalysis />} />
        <Route path="/testing" element={<LittlefieldAnalysis />} />
      </Routes>
    </LittlefieldProvider>
  );
}

export default App;
