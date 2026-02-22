import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import LanguageBar from '../components/LanguageBar';

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/admin/dashboard', { replace: true });
      }
    });
  }, [navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(t('admin.loginError'));
        return;
      }

      // Check admin allowlist
      const { data } = await supabase
        .from('admin_users')
        .select('email')
        .eq('email', email)
        .single();

      if (!data) {
        await supabase.auth.signOut();
        setError(t('admin.notAdmin'));
        return;
      }

      navigate('/admin/dashboard', { replace: true });
    } catch {
      setError(t('admin.loginError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login">
      <LanguageBar />
      <div className="admin-login-card">
        <h1>GiroTrash Admin</h1>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">{t('admin.email')}</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.password')}</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? (
              <div className="spinner" />
            ) : (
              t('admin.login')
            )}
          </button>
          {error && <div className="admin-login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}
