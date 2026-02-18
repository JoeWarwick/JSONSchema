import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import styles from './regex-input.module.css';
import { Badge } from './ui/badge/badge';

interface RegexInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}

const COMMON_TOKENS = [
  { label: '\\d', value: '\\d', desc: 'Digit (0-9)', category: 'Classes' },
  { label: '\\w', value: '\\w', desc: 'Word (a-z, A-Z, 0-9, _)', category: 'Classes' },
  { label: '\\s', value: '\\s', desc: 'Whitespace (space, tab, etc.)', category: 'Classes' },
  { label: '.', value: '.', desc: 'Any character except newline', category: 'Classes' },
  { label: '+', value: '+', desc: 'One or more', category: 'Quantifiers' },
  { label: '*', value: '*', desc: 'Zero or more', category: 'Quantifiers' },
  { label: '?', value: '?', desc: 'Zero or one (optional)', category: 'Quantifiers' },
  { label: '{n,m}', value: '{1,3}', desc: 'Range of occurrences', category: 'Quantifiers' },
  { label: '^', value: '^', desc: 'Start of string', category: 'Anchors' },
  { label: '$', value: '$', desc: 'End of string', category: 'Anchors' },
  { label: '\\b', value: '\\b', desc: 'Word boundary', category: 'Anchors' },
  { label: '|', value: '|', desc: 'Alternation (OR)', category: 'Logic' },
  { label: '(...)', value: '()', desc: 'Capturing group', category: 'Groups' },
  { label: '[...]', value: '[]', desc: 'Character set', category: 'Groups' },
];

const TEMPLATES = [
  { name: 'Email Address', value: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' },
  { name: 'IPv4 Address', value: '^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$' },
  { name: 'ISO Date (YYYY-MM-DD)', value: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' },
  { name: 'Phone Number (US)', value: '^\\(\\d{3}\\)\\s\\d{3}-\\d{4}$' },
];

export function RegexInput({ value, onChange, onBlur, className, placeholder, 'aria-label': ariaLabel }: RegexInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [testValue, setTestValue] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Validate regex on value change
  useEffect(() => {
    try {
      if (value) {
        new RegExp(value);
      }
      setIsValid(true);
      setErrorMsg(null);
    } catch (e: any) {
      setIsValid(false);
      setErrorMsg(e.message.replace('Invalid regular expression: ', ''));
    }
  }, [value]);

  const testResult = useMemo(() => {
    if (!value || !isValid) return null;
    try {
      const re = new RegExp(value);
      return re.test(testValue);
    } catch (e) {
      return null;
    }
  }, [value, isValid, testValue]);

  const explainRegex = (regex: string) => {
    if (!regex) return "No pattern defined.";
    if (!isValid) return "Invalid expression.";

    const explanations: string[] = [];
    if (regex.startsWith('^')) explanations.push("Starts with...");
    if (regex.endsWith('$')) explanations.push("Ends with...");
    if (regex.includes('\\d')) explanations.push("contains digits (0-9)");
    if (regex.includes('\\w')) explanations.push("contains word characters");
    if (regex.includes('|')) explanations.push("has alternate choices (OR)");
    if (regex.includes('+') || regex.includes('*')) explanations.push("repeats elements");
    
    if (explanations.length === 0) return "A literal or basic pattern.";
    return explanations.join(", ");
  };

  const insertToken = (token: string) => {
    if (!inputRef.current) return;
    const start = inputRef.current.selectionStart || 0;
    const end = inputRef.current.selectionEnd || 0;
    const newValue = value.slice(0, start) + token + value.slice(end);
    onChange(newValue);
    
    // Set focus back and move cursor inside if needed (e.g. for groups)
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const cursorPosition = start + token.length;
        if (token === '()' || token === '[]') {
          inputRef.current.setSelectionRange(cursorPosition - 1, cursorPosition - 1);
        } else {
          inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
        }
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '\\' || e.key === '(' || e.key === '[' || e.key === '|') {
      setIsOpen(true);
    }
  };

  return (
    <div className={styles.container}>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger asChild>
          <input
            ref={inputRef}
            type="text"
            className={`${styles.input} ${!isValid ? styles.inputError : ''} ${className || ''}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "^regex$"}
            aria-label={ariaLabel}
          />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={5} className={styles.popoverContent}>
            
            {/* Live Explainer/Status */}
            <div className={styles.explainer}>
              <strong>Pattern Logic:</strong> {explainRegex(value)}
              {!isValid && errorMsg && (
                <div style={{ color: 'var(--color-error-11)', marginTop: 4 }}>
                  ⚠️ {errorMsg}
                </div>
              )}
            </div>

            {/* Live Tester */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Live Tester</div>
              <div className={styles.tester}>
                <input 
                  type="text" 
                  className={styles.testerInput}
                  placeholder="Test string..."
                  value={testValue}
                  onChange={(e) => setTestValue(e.target.value)}
                />
                <div className={styles.testerResult}>
                  {testValue === '' ? (
                    <span style={{ color: 'var(--color-neutral-10)' }}>Enter text to test match</span>
                  ) : testResult === null ? (
                    <span className={styles.noMatch}>- waiting -</span>
                  ) : testResult ? (
                    <span className={styles.match}>✓ Matches!</span>
                  ) : (
                    <span className={styles.noMatch}>✗ No match</span>
                  )}
                </div>
              </div>
            </div>

            {/* Common Tokens Grid */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Tokens (Intellisense)</div>
              <div className={styles.grid}>
                {COMMON_TOKENS.map(token => (
                  <button 
                    key={token.label}
                    className={styles.tokenButton}
                    title={token.desc}
                    onClick={() => insertToken(token.value)}
                  >
                    {token.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Predefined Templates */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Templates</div>
              <div className={styles.templateList}>
                {TEMPLATES.map(tmpl => (
                  <div 
                    key={tmpl.name} 
                    className={styles.templateItem} 
                    onClick={() => {
                      onChange(tmpl.value);
                      setIsOpen(false);
                    }}
                  >
                    {tmpl.name}
                  </div>
                ))}
              </div>
            </div>

            <Popover.Arrow fill="var(--color-neutral-6)" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
