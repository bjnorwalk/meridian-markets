import { useState, type FormEvent } from 'react'
import { Activity, KeyRound, User } from 'lucide-react'
import '../App.css'
import {
  confirmPasswordReset,
  loginUser,
  registerUser,
  requestPasswordReset,
  type AuthUser,
  type PasswordResetRequest,
} from '../services/userApi'

type AuthMode = 'login' | 'register' | 'reset-request' | 'reset-confirm'

export default function AuthScreen({
  onAuth,
}: {
  onAuth: (user: AuthUser) => void
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetInfo, setResetInfo] = useState<PasswordResetRequest | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const authTitle =
    mode === 'login'
      ? 'Sign in'
      : mode === 'register'
        ? 'Create account'
        : mode === 'reset-request'
          ? 'Reset password'
          : 'New password'
  const authSubtitle =
    mode === 'reset-request'
      ? 'Generate a short-lived reset code for this workspace.'
      : mode === 'reset-confirm'
        ? 'Set a new password and return to your workspace.'
        : 'Save your own watchlist and return to it later.'
  const submitLabel =
    mode === 'login'
      ? 'Sign in'
      : mode === 'register'
        ? 'Create account'
        : mode === 'reset-request'
          ? 'Get reset code'
          : 'Reset password'

  const switchMode = (nextMode: AuthMode) => {
    setAuthError(null)
    setAuthMessage(null)
    setPassword('')
    setConfirmPassword('')
    setMode(nextMode)

    if (nextMode !== 'reset-confirm') {
      setResetCode('')
      setResetInfo(null)
    }
  }

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)
    setAuthMessage(null)

    if (mode === 'reset-confirm' && password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      return
    }

    setIsSubmitting(true)

    try {
      if (mode === 'reset-request') {
        const payload = await requestPasswordReset(username)
        setResetInfo(payload.reset)
        setResetCode(payload.reset.resetCode ?? '')
        setPassword('')
        setConfirmPassword('')
        if (payload.reset.emailed) {
          setAuthMessage('If the account exists, a reset code has been sent.')
        } else if (payload.reset.resetCode) {
          setAuthMessage('Reset code generated for this workspace.')
        } else {
          setAuthMessage('If the account exists, use the reset code sent to its email.')
        }
        setMode('reset-confirm')
        return
      }

      const payload =
        mode === 'reset-confirm'
          ? await confirmPasswordReset(username, resetCode, password)
          : mode === 'login'
            ? await loginUser(username, password)
            : await registerUser(username, password, email)
      onAuth(payload.user)
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'Authentication failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="Account access">
        <div className="brand auth-brand">
          <span className="brand-mark">
            <Activity aria-hidden="true" size={18} />
          </span>
          <div>
            <strong>Meridian Markets</strong>
            <small>Personal market workspace</small>
          </div>
        </div>

        <form className="auth-form" onSubmit={submitAuth}>
          <div>
            <h1>{authTitle}</h1>
            <p>{authSubtitle}</p>
          </div>

          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              readOnly={mode === 'reset-confirm'}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              required
              type="text"
              value={username}
            />
          </label>

          {mode === 'register' && (
            <label>
              <span>Email (optional — for password reset)</span>
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>
          )}

          {mode === 'reset-confirm' && resetInfo && resetInfo.resetCode && (
            <div className="auth-reset-card">
              <span>Reset code</span>
              <strong>{resetInfo.resetCode}</strong>
              <small>
                Expires at{' '}
                {new Date(resetInfo.expiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </div>
          )}

          {mode === 'reset-confirm' && (
            <label>
              <span>Reset code</span>
              <input
                autoComplete="one-time-code"
                className="auth-code-input"
                onChange={(event) => setResetCode(event.target.value)}
                required
                type="text"
                value={resetCode}
              />
            </label>
          )}

          {mode !== 'reset-request' && (
            <label>
              <span>{mode === 'reset-confirm' ? 'New password' : 'Password'}</span>
              <input
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
          )}

          {mode === 'reset-confirm' && (
            <label>
              <span>Confirm password</span>
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
          )}

          {authError && <div className="auth-error">{authError}</div>}
          {authMessage && <div className="auth-message">{authMessage}</div>}

          <button className="auth-submit" disabled={isSubmitting} type="submit">
            {mode.startsWith('reset') ? (
              <KeyRound aria-hidden="true" size={16} />
            ) : (
              <User aria-hidden="true" size={16} />
            )}
            {isSubmitting ? 'Working' : submitLabel}
          </button>

          <div className="auth-options">
            {mode === 'login' && (
              <>
                <button
                  className="auth-mode"
                  disabled={isSubmitting}
                  onClick={() => switchMode('register')}
                  type="button"
                >
                  Create a new account
                </button>
                <button
                  className="auth-link-button"
                  disabled={isSubmitting}
                  onClick={() => switchMode('reset-request')}
                  type="button"
                >
                  Forgot password?
                </button>
              </>
            )}

            {mode === 'register' && (
              <button
                className="auth-mode"
                disabled={isSubmitting}
                onClick={() => switchMode('login')}
                type="button"
              >
                Use existing account
              </button>
            )}

            {mode === 'reset-request' && (
              <button
                className="auth-mode"
                disabled={isSubmitting}
                onClick={() => switchMode('login')}
                type="button"
              >
                Back to sign in
              </button>
            )}

            {mode === 'reset-confirm' && (
              <>
                <button
                  className="auth-mode"
                  disabled={isSubmitting}
                  onClick={() => switchMode('reset-request')}
                  type="button"
                >
                  Request new code
                </button>
                <button
                  className="auth-link-button"
                  disabled={isSubmitting}
                  onClick={() => switchMode('login')}
                  type="button"
                >
                  Back to sign in
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </main>
  )
}
