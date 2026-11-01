import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { usePlayer } from './PlayerContext.jsx';
import Header from './components/Header.jsx';
import Welcome from './pages/Welcome.jsx';
import Home from './pages/Home.jsx';
import CreateTeam from './pages/CreateTeam.jsx';
import Team from './pages/Team.jsx';
import Notifications from './pages/Notifications.jsx';
import CreateMatch from './pages/CreateMatch.jsx';
import Toss from './pages/Toss.jsx';
import Scorer from './pages/Scorer.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import StaleApiBanner from './components/StaleApiBanner.jsx';
import MatchResult from './pages/MatchResult.jsx';
import Profile from './pages/Profile.jsx';
import Matches from './pages/Matches.jsx';
import Tournaments from './pages/Tournaments.jsx';
import NewTournament from './pages/NewTournament.jsx';
import Tournament from './pages/Tournament.jsx';
import TournamentAddMatch from './pages/TournamentAddMatch.jsx';

export default function App() {
  const { player, ready } = usePlayer();
  const location = useLocation();
  if (!ready) return null;

  return (
    <>
      <Header />
      <StaleApiBanner />
      <main className={player ? 'page' : 'page page--full'}>
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/" element={player ? <Navigate to="/home" replace /> : <Welcome />} />
            <Route path="/home" element={player ? <Home /> : <Navigate to="/" replace />} />
            <Route path="/teams/new" element={player ? <CreateTeam /> : <Navigate to="/" replace />} />
            <Route path="/teams/:name" element={player ? <Team /> : <Navigate to="/" replace />} />
            <Route path="/matches" element={player ? <Matches /> : <Navigate to="/" replace />} />
            <Route path="/matches/new" element={player ? <CreateMatch /> : <Navigate to="/" replace />} />
            <Route path="/matches/:id" element={player ? <MatchResult /> : <Navigate to="/" replace />} />
            <Route path="/matches/:id/toss" element={player ? <Toss /> : <Navigate to="/" replace />} />
            <Route path="/matches/:id/score" element={player ? <Scorer /> : <Navigate to="/" replace />} />
            <Route path="/tournaments" element={player ? <Tournaments /> : <Navigate to="/" replace />} />
            <Route path="/tournaments/new" element={player ? <NewTournament /> : <Navigate to="/" replace />} />
            <Route path="/tournaments/:id" element={player ? <Tournament /> : <Navigate to="/" replace />} />
            <Route path="/tournaments/:id/add" element={player ? <TournamentAddMatch /> : <Navigate to="/" replace />} />
            <Route path="/players/:name"element={player ? <Profile /> : <Navigate to="/" replace />} />
            <Route
              path="/notifications"
              element={player ? <Notifications /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  );
}
