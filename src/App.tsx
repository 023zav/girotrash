import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ReportFlow from './pages/ReportFlow';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AdminReportDetail from './pages/AdminReportDetail';
import './i18n';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ReportFlow />} />
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/report/:id" element={<AdminReportDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
