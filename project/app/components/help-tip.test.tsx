import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HelpTip } from './help-tip';

describe('HelpTip', () => {
  it('keeps guidance out of the flow and reveals it on keyboard focus with an accessible description', async () => {
    render(<HelpTip label="Mapping">Map leaf fields or repeating groups.</HelpTip>);
    const button = screen.getByRole('button', { name: 'Help: Mapping' });
    expect(button).toHaveTextContent('!');
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.queryByText('Map leaf fields or repeating groups.')).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Map leaf fields or repeating groups.');
    expect(button).toHaveAccessibleDescription('Map leaf fields or repeating groups.');
    fireEvent.keyDown(button, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('does not submit a surrounding form and retains visible warnings', async () => {
    const submit = jest.fn(event => event.preventDefault());
    render(<form onSubmit={submit}>
      <HelpTip>Optional instructions</HelpTip>
      <p role="alert">Invalid schema</p>
      <p role="status">Source has changed</p>
    </form>);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid schema');
    expect(screen.getByRole('status')).toHaveTextContent('Source has changed');
  });
});
