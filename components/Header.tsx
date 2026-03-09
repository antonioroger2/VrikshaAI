import TreeLogo from './TreeLogo';

interface HeaderProps {
  lang: string;
  setLang: (lang: string) => void;
}

const Header = ({ lang, setLang }: HeaderProps) => {
  return (
    <header className="header">
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

      <div className="status-pill">
        <div className="status-dot" />
        <span>LangGraph Active</span>
        <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
        <span>ap-south-1</span>
      </div>
    </header>
  );
};

export default Header;