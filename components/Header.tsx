import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { loadLocalKeys } from '../lib/api-config';
import TreeLogo from './TreeLogo';
import BYOKModal from './BYOKModal';

interface HeaderProps {
  lang: string;
  setLang: (lang: string) => void;
}

const Header = ({ lang, setLang }: HeaderProps) => {
  const [showBYOK, setShowBYOK] = useState(false);

  useEffect(() => {
    loadLocalKeys();
  }, []);

  return (
    <header className="header">
      {showBYOK && <BYOKModal onClose={() => setShowBYOK(false)} />}
      <div className="logo">
        <TreeLogo />
        <div>
          <div className="logo-name">VRIKSHA<span>.ai</span></div>
          <div className="logo-sub">वृक्ष · Cloud Architect · Vernacular Builder</div>
        </div>
      </div>

      <div className="lang-selector">
        {["en", "hi", "ta", "te", "ml", "bn", "mr", "gu", "kn", "pa", "or"].map(l => (
          <button key={l} className={`lang-btn ${lang === l ? "active" : ""}`} onClick={() => setLang(l)}>
            {l === "en" ? "EN" : 
             l === "hi" ? "हिं" : 
             l === "ta" ? "தமி" : 
             l === "te" ? "తె" :
             l === "ml" ? "മല" :
             l === "bn" ? "বাং" :
             l === "mr" ? "मर" :
             l === "gu" ? "ગુ" :
             l === "kn" ? "ಕನ" :
             l === "pa" ? "ਪੰ" :
             l === "or" ? "ଓଡ" : l.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button 
          onClick={() => setShowBYOK(true)}
          style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#a0aec0', padding: '6px', borderRadius: '6px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          title="API Settings (Bring Your Own Key)"
        >
          <Settings size={16} />
        </button>

        <div className="status-pill">
          <div className="status-dot" />
          <span>LangGraph Active</span>
          <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
          <span>ap-south-1</span>
        </div>
      </div>
    </header>
  );
};

export default Header;