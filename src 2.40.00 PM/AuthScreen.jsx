import { useState } from 'react';
import { supabase } from '../../network/supabaseClient';
import './AuthScreen.css';

function AuthScreen({ onAuth }) {
  const [mode,     setMode]     = useState('login');   // 'login' | 'signup'
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);      // signup confirmation

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); }
      else        { setDone(true); }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); }
      else        { onAuth?.(); }
    }

    setLoading(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">canopy</div>
        <p className="auth-tagline">workflow and life management</p>

        {done ? (
          <div className="auth-confirm">
            <p>Check your inbox.</p>
            <span>We sent a confirmation link to <strong>{email}</strong>. Click it then come back to sign in.</span>
            <button className="btn-ghost" onClick={() => { setDone(false); setMode('login'); }}>Back to sign in</button>
          </div>
        ) : (
          <>
            <div className="auth-tabs">
              <button
                className={mode === 'login'  ? 'auth-tab auth-tab--active' : 'auth-tab'}
                onClick={() => { setMode('login');  setError(''); }}
              >Sign in</button>
              <button
                className={mode === 'signup' ? 'auth-tab auth-tab--active' : 'auth-tab'}
                onClick={() => { setMode('signup'); setError(''); }}
              >Create account</button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span className="label-sm">email</span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </label>
              <label className="auth-field">
                <span className="label-sm">password</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'min. 6 characters' : ''}
                  required
                />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <button
                type="submit"
                className="btn-primary auth-submit"
                disabled={loading}
              >
                {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthScreen;
