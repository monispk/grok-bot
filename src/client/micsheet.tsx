import { useEffect } from 'preact/hooks'
import { chromeIntentUrl, isAndroid, isIOS } from './device.ts'
import { watchPermission, type MicProblem } from './recorder.ts'

/**
 * The sheet that comes up when the microphone cannot be used — one for each way
 * that happens, because they need different things done about them.
 *
 * Every line here is also spoken by the chat behind the sheet, once. The people
 * this is for do not read settings screens well, which is the whole reason the
 * microphone matters; a sheet that only wrote out the instructions would be
 * explaining the microphone to someone who needs the microphone to be
 * explained to.
 */
export function MicSheet({
  kind,
  onClose,
  onAllow,
  onRetry,
  onRecorderApp,
  onType,
}: {
  kind: MicProblem
  onClose: () => void
  onAllow: () => void
  onRetry: () => void
  onRecorderApp: () => void
  onType: () => void
}) {
  const ua = navigator.userAgent
  const android = isAndroid(ua)

  // The rider went into site settings and allowed it. Nothing to press.
  useEffect(() => {
    if (kind !== 'blocked') return
    return watchPermission((s) => {
      if (s === 'granted') onRetry()
    })
  }, [kind, onRetry])

  const typeInstead = (
    <button class="sheet-alt" onClick={onType}>
      Likh kar jawab dein
    </button>
  )
  const recorderApp = (
    <button class="sheet-alt" onClick={onRecorderApp}>
      Phone ke recorder se voice note bhejein
    </button>
  )

  return (
    <div class="sheetback" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <span class="sheet-grip" />

        {kind === 'unsupported' && (
          <>
            <h2>Ye browser voice note nahi bhej sakta</h2>
            <p>Is page ko Chrome mein kholein. Wahan microphone chalta hai.</p>
            {android ? (
              <a class="sheet-main" href={chromeIntentUrl(location.href)}>
                Chrome mein kholein
              </a>
            ) : (
              <p class="sheet-how">
                {isIOS(ua)
                  ? 'Share ka button daba kar "Open in Safari" chunein.'
                  : 'Menu (⋮) mein "Open in browser" ya "Chrome" chunein.'}
              </p>
            )}
            {recorderApp}
            {typeInstead}
          </>
        )}

        {kind === 'ask' && (
          <>
            <MicIcon />
            <h2>Bolne ke liye microphone ki ijazat chahiye</h2>
            <p>
              Ab phone poochay ga. <strong>Allow</strong> dabayein.
            </p>
            <button class="sheet-main" onClick={onAllow}>
              Theek hai
            </button>
            {typeInstead}
          </>
        )}

        {kind === 'blocked' && (
          <>
            <h2>Microphone band hai</h2>
            <p>Isay is tarah kholein:</p>
            <BlockedGuide />
            <ol class="sheet-steps">
              <li>
                Upar address ke saath <strong>taalay</strong> (🔒) ke nishan par dabayein
              </li>
              <li>
                <strong>Permissions</strong> par dabayein
              </li>
              <li>
                <strong>Microphone</strong> ko <strong>Allow</strong> karein
              </li>
              <li>Wapas aa kar microphone dabaye rakhein</li>
            </ol>
            <button class="sheet-main" onClick={onRetry}>
              Dobara koshish karein
            </button>
            {recorderApp}
            {typeInstead}
          </>
        )}

        {kind === 'busy' && (
          <>
            <h2>Microphone kisi aur app mein chal raha hai</h2>
            <p>Call ya doosri app band kar ke dobara koshish karein.</p>
            <button class="sheet-main" onClick={onRetry}>
              Dobara koshish karein
            </button>
            {typeInstead}
          </>
        )}

        {(kind === 'none' || kind === 'other') && (
          <>
            <h2>Microphone nahi mil raha</h2>
            <p>Is phone ya browser mein microphone nahi chal raha.</p>
            {android && (
              <a class="sheet-main" href={chromeIntentUrl(location.href)}>
                Chrome mein kholein
              </a>
            )}
            {recorderApp}
            {typeInstead}
          </>
        )}
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg class="sheet-icon" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15z"
        fill="currentColor"
      />
      <path
        d="M18.5 11.2a6.5 6.5 0 0 1-13 0M12 17.8V21"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
      />
    </svg>
  )
}

/**
 * A drawing of what to press: Chrome's address bar with the lock, then the
 * permissions row with the microphone switched on. Drawn rather than
 * screenshotted so it reads the same on every phone's theme.
 */
function BlockedGuide() {
  return (
    <svg class="sheet-guide" viewBox="0 0 320 132" aria-hidden="true">
      {/* address bar */}
      <rect x="8" y="8" width="304" height="36" rx="18" fill="var(--guide-bar)" />
      <circle cx="30" cy="26" r="14" fill="var(--accent)" opacity=".18" />
      <rect x="25" y="24" width="10" height="9" rx="2" fill="none" stroke="var(--accent)" stroke-width="2" />
      <path d="M27 24v-3a3 3 0 0 1 6 0v3" fill="none" stroke="var(--accent)" stroke-width="2" />
      <rect x="52" y="21" width="150" height="10" rx="5" fill="var(--guide-text)" />
      <path d="M22 44 l8 10 l8 -10" fill="var(--accent)" />
      <text x="30" y="47" font-size="10" fill="var(--accent)" font-weight="700" text-anchor="middle">1</text>
      {/* permissions row */}
      <rect x="8" y="60" width="304" height="30" rx="8" fill="var(--guide-bar)" />
      <text x="20" y="80" font-size="13" fill="var(--fg)" font-family="system-ui, sans-serif">Permissions</text>
      <text x="292" y="80" font-size="13" fill="var(--muted)" text-anchor="end">›</text>
      <circle cx="298" cy="60" r="9" fill="var(--accent)" />
      <text x="298" y="64" font-size="10" fill="#fff" font-weight="700" text-anchor="middle">2</text>
      {/* microphone allow row */}
      <rect x="8" y="96" width="304" height="30" rx="8" fill="var(--guide-bar)" />
      <text x="20" y="116" font-size="13" fill="var(--fg)" font-family="system-ui, sans-serif">Microphone</text>
      <rect x="258" y="103" width="40" height="18" rx="9" fill="var(--accent)" />
      <circle cx="290" cy="112" r="7" fill="#fff" />
      <text x="248" y="116" font-size="11" fill="var(--accent)" font-weight="700" text-anchor="end">Allow</text>
      <circle cx="298" cy="96" r="9" fill="var(--accent)" />
      <text x="298" y="100" font-size="10" fill="#fff" font-weight="700" text-anchor="middle">3</text>
    </svg>
  )
}
