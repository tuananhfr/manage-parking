import Body from "./Body";

/**
 * Layout - Main layout component for Camera AI tab
 */
const Layout = ({
  cameras,
  onHistoryUpdate,
}) => {
  return <Body cameras={cameras} onHistoryUpdate={onHistoryUpdate} />;
};

export default Layout;
