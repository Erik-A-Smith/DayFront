import { useState } from 'react';

interface ClockInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

type ClockStep = 'hour' | 'minute' | 'period';

function clockPosition(index: number, total: number) {
  const angle = (index / total) * Math.PI * 2;
  return {
    left: `${50 + Math.sin(angle) * 40}%`,
    top: `${50 - Math.cos(angle) * 40}%`,
  };
}

function displayTime(value: string): string {
  if (!value) return 'Choose time';
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function ClockInput({ label, value, onChange }: ClockInputProps) {
  const parsedHour = Number(value.slice(0, 2));
  const parsedMinute = Number(value.slice(3, 5));
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ClockStep>('hour');
  const [hour, setHour] = useState(
    Number.isFinite(parsedHour) ? parsedHour % 12 || 12 : 12,
  );
  const [minute, setMinute] = useState(
    Number.isFinite(parsedMinute) ? parsedMinute : 0,
  );

  function begin() {
    const currentHour = Number(value.slice(0, 2));
    const currentMinute = Number(value.slice(3, 5));
    setHour(Number.isFinite(currentHour) ? currentHour % 12 || 12 : 12);
    setMinute(Number.isFinite(currentMinute) ? currentMinute : 0);
    setStep('hour');
    setOpen(true);
  }

  function choosePeriod(period: 'AM' | 'PM') {
    const value24 = period === 'AM' ? hour % 12 : (hour % 12) + 12;
    onChange(
      `${String(value24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    );
    setOpen(false);
  }

  const values =
    step === 'hour'
      ? Array.from({ length: 12 }, (_, index) => index + 1)
      : Array.from({ length: 12 }, (_, index) => index * 5);

  return (
    <>
      <button
        type="button"
        className="clock-trigger"
        aria-label={label}
        onClick={begin}
      >
        <span aria-hidden="true">◷</span>
        {displayTime(value)}
      </button>
      {open && (
        <div
          className="clock-backdrop"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            className="clock-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} picker`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="clock-heading">
              <div>
                <p>{label}</p>
                <h3>
                  {step === 'hour'
                    ? 'Choose hour'
                    : step === 'minute'
                      ? 'Choose minutes'
                      : 'Choose AM or PM'}
                </h3>
              </div>
              <button
                type="button"
                className="clock-close"
                aria-label="Close time picker"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            {step !== 'period' ? (
              <div className="clock-face">
                {values.map((item, index) => (
                  <button
                    type="button"
                    style={clockPosition(index, values.length)}
                    onClick={() => {
                      if (step === 'hour') {
                        setHour(item);
                        setStep('minute');
                      } else {
                        setMinute(item);
                        setStep('period');
                      }
                    }}
                    key={item}
                  >
                    {step === 'minute' ? String(item).padStart(2, '0') : item}
                  </button>
                ))}
                <span className="clock-center" aria-hidden="true" />
              </div>
            ) : (
              <div className="period-options">
                <button type="button" onClick={() => choosePeriod('AM')}>
                  AM
                </button>
                <button type="button" onClick={() => choosePeriod('PM')}>
                  PM
                </button>
              </div>
            )}

            <div className="clock-footer">
              {step !== 'hour' && (
                <button
                  type="button"
                  onClick={() => setStep(step === 'period' ? 'minute' : 'hour')}
                >
                  ← Back
                </button>
              )}
              <span />
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
