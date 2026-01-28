import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';

describe('Tooltip behavior', () => {
  test('only one tooltip open at a time when hovering between triggers', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="t1">hover1</button>
            </TooltipTrigger>
            <TooltipContent>first tooltip content</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="t2">hover2</button>
            </TooltipTrigger>
            <TooltipContent>second tooltip content</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );

    const t1 = screen.getByLabelText('t1');
    const t2 = screen.getByLabelText('t2');

    // Hover first trigger (mouse enter + focus to reliably surface tooltip)
    fireEvent.mouseEnter(t1);
    fireEvent.focus(t1);
    const firstMatches = await screen.findAllByText('first tooltip content');
    expect(firstMatches.length).toBeGreaterThan(0);
    // At least one match should be part of an open tooltip
    expect(firstMatches.some(el => Boolean(el.closest('[data-state="instant-open"]') || el.parentElement?.getAttribute('data-state') === 'instant-open'))).toBeTruthy();

    // Hover second trigger -> first should close, second should open
    fireEvent.mouseEnter(t2);
    fireEvent.focus(t2);
    const secondMatches = await screen.findAllByText('second tooltip content');
    expect(secondMatches.length).toBeGreaterThan(0);
    // Ensure no first tooltip matches are open anymore
    const stillOpenFirst = (await screen.queryAllByText('first tooltip content')).some(el => Boolean(el.closest('[data-state="instant-open"]') || el.parentElement?.getAttribute('data-state') === 'instant-open'));
    expect(stillOpenFirst).toBeFalsy();
  });
});
