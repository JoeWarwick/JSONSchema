import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from 'sonner';
import { AccountDialog } from './account-dialog';
import { getAuthSession, submitAuth, type AuthSession } from '../utils/auth-client';

jest.mock('../utils/auth-client', () => ({
  getAuthSession: jest.fn(),
  submitAuth: jest.fn(),
  googleRedirectUrl: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

const sessionMock = jest.mocked(getAuthSession);
const submitMock = jest.mocked(submitAuth);
const anonymous: AuthSession = { user: null, csrfToken: 'token', googleEnabled: false };
const signedIn: AuthSession = {
  ...anonymous, googleEnabled: true,
  user: { email: 'joe@example.com', emailConfirmed: true, hasPassword: true, hasGoogleLogin: true },
};

async function openAccount() {
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
}

describe('Account dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionMock.mockResolvedValue(anonymous);
    submitMock.mockResolvedValue(null);
    window.history.replaceState(null, '', '/');
  });

  it('does not require the backend until opened and presents optional sign-in', async () => {
    render(<AccountDialog />);
    expect(sessionMock).not.toHaveBeenCalled();
    await openAccount();
    expect(screen.getByText(/Sign-in is optional for local editing/)).toBeInTheDocument();
    expect(screen.getByText('Google sign-in is not configured on this server.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });

  it('registers an account and directs the user to verify email without assuming sign-in', async () => {
    render(<AccountDialog />);
    await openAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-42!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith('register', {
      email: 'joe@example.com', password: 'Correct-Horse-42!',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('confirmation email');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('mounts a distinct registration form with password-generation and autofill hints', async () => {
    render(<AccountDialog />);
    await openAccount();
    const loginPassword = screen.getByLabelText('Password');
    const loginForm = loginPassword.closest('form');
    expect(loginPassword).toHaveAttribute('autocomplete', 'current-password');

    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    const registerPassword = screen.getByLabelText('Password');
    expect(registerPassword).not.toBe(loginPassword);
    expect(registerPassword.closest('form')).not.toBe(loginForm);
    expect(registerPassword).toHaveAttribute('id', 'account-register-password');
    expect(registerPassword).toHaveAttribute('name', 'new-password');
    expect(registerPassword).toHaveAttribute('autocomplete', 'new-password');
    expect(registerPassword.closest('form')).toHaveAttribute('autocomplete', 'on');
    expect(screen.getByLabelText('Email')).toHaveAttribute('name', 'username');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText('Password')).not.toBe(registerPassword);
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('shows an inline error when browser validation prevents registration', async () => {
    render(<AccountDialog />);
    await openAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not submitted. Password:');
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('signs in and out without modifying local workbenches', async () => {
    localStorage.setItem('schema-sculptor-workspace-v1', 'unchanged');
    render(<AccountDialog />);
    await openAccount();
    sessionMock.mockResolvedValue(signedIn);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-42!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Signed in successfully.');
    expect(localStorage.getItem('schema-sculptor-workspace-v1')).toBe('unchanged');
    await openAccount();
    expect(await screen.findByText('Signed in as joe@example.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    sessionMock.mockResolvedValue(anonymous);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/You have signed out/)).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledWith('logout', {});
    expect(localStorage.getItem('schema-sculptor-workspace-v1')).toBe('unchanged');
  });

  it('shows a Google sign-in confirmation without opening account settings', () => {
    window.history.replaceState(null, '', '/?auth=google-success&keep=yes');
    render(<AccountDialog />);
    expect(toast.success).toHaveBeenCalledWith('Google sign-in completed.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?keep=yes');
  });

  it('surfaces failures and permits retry while leaving local editing available', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    sessionMock.mockRejectedValueOnce(new Error('Connection refused'));
    render(<AccountDialog />);
    await openAccount();
    expect(screen.getByRole('alert')).toHaveTextContent('Local editing and downloads still work');
    expect(screen.getByLabelText('Email')).not.toBeDisabled();
    expect(screen.getByLabelText('Password')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('account service is unavailable');
    fireEvent.click(screen.getByLabelText('Email'));
    screen.getByLabelText('Email').focus();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'draft@example.com' } });
    screen.getByLabelText('Password').focus();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Draft-Password-42!' } });
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry account connection' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).not.toBeDisabled());
    expect(screen.getByLabelText('Email')).toHaveValue('draft@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    log.mockRestore();
  });

  it('consumes email verification credentials from history and requires explicit confirmation', async () => {
    window.history.replaceState(null, '', '/?auth=confirm-email&userId=user-id&token=secret&keep=yes');
    render(<AccountDialog />);
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify email' })).not.toBeDisabled());
    expect(window.location.search).toBe('?keep=yes');
    expect(submitMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText('Your email is verified. You can now sign in.')).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledWith('confirm-email', { userId: 'user-id', token: 'secret' });
  });

  it('uses the reset link email and token for password recovery', async () => {
    window.history.replaceState(null, '', '/?auth=reset-password&email=joe%40example.com&token=secret');
    render(<AccountDialog />);
    await waitFor(() => expect(screen.getByLabelText('New password')).not.toBeDisabled());
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(window.location.search).toBe('');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Another-Horse-42!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText(/Your password has been reset/)).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledWith('reset-password', {
      email: 'joe@example.com', token: 'secret', password: 'Another-Horse-42!',
    });
  });

  it('requires a current password before unlinking and preserves the last login method', async () => {
    sessionMock.mockResolvedValue(signedIn);
    render(<AccountDialog />);
    await openAccount();
    expect(screen.getByRole('button', { name: 'Unlink Google' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Google' }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith('google/unlink', { password: 'current-password' }));
  });

  it('does not allow a Google-only user to remove their last login method', async () => {
    sessionMock.mockResolvedValue({
      ...signedIn,
      user: { email: 'joe@example.com', emailConfirmed: true, hasPassword: false, hasGoogleLogin: true },
    });
    render(<AccountDialog />);
    await openAccount();
    expect(screen.getByRole('button', { name: 'Unlink Google' })).toBeDisabled();
    expect(screen.getByText('Set a password before unlinking your only sign-in method.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set a password' })).toBeInTheDocument();
  });

  it('requests password recovery without claiming the account exists', async () => {
    render(<AccountDialog />);
    await openAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));
    expect(await screen.findByText(/If this address belongs to a verified account/)).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledWith('forgot-password', { email: 'joe@example.com' });
  });

  it('keeps the account dialog open and preserves input after rejected credentials', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    submitMock.mockRejectedValueOnce(new Error('Invalid email or password.'));
    render(<AccountDialog />);
    await openAccount();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByLabelText('Email')).toHaveValue('joe@example.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
    log.mockRestore();
  });

  it('prevents duplicate submissions while waiting for the server', async () => {
    let finish: (() => void) | undefined;
    submitMock.mockImplementation(() => new Promise(resolve => { finish = () => resolve(null); }));
    render(<AccountDialog />);
    await openAccount();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'joe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Correct-Horse-42!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    await act(async () => finish?.());
  });
});
