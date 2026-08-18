import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

function Layout() {
  return (
    <>
      <Sidebar />
      <Topbar />
      <main className="main-content">
        <Outlet />
      </main>
    </>
  )
}

export default Layout
