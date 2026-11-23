// Which Ask AI section is showing (Library · AI chat · Studio) and which document Studio has open.
// Documents themselves are kept by the app state (made / saveMade) on this device.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useApp } from './app.jsx';

const StudioCtx = createContext(null);
export const useStudio = () => useContext(StudioCtx);

export function StudioProvider({ children }) {
  const { go } = useApp();
  const [seg, setSeg] = useState('chat');
  const [openId, setOpenId] = useState(null);

  const openInStudio = useCallback((id) => {
    setOpenId(id);
    setSeg('studio');
    go('ask');
  }, [go]);
  const openChat = useCallback(() => { setSeg('chat'); go('ask'); }, [go]);

  const value = useMemo(() => ({ seg, setSeg, openId, setOpenId, openInStudio, openChat }), [seg, openId, openInStudio, openChat]);
  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}
