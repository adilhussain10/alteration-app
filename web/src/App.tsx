import { Route, Routes } from 'react-router-dom';
import { BillPickerPage } from './pages/BillPickerPage';
import { AlterationPage } from './pages/AlterationPage';
import { ToastProvider } from './components/Toast';

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<BillPickerPage />} />
        <Route path="/alteration" element={<AlterationPage />} />
      </Routes>
    </ToastProvider>
  );
}
