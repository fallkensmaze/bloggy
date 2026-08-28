import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Blog from './pages/Blog'
import ConvertUnits from './pages/ConvertUnits'
import DecayCalculator from './pages/DecayCalculator'
import RestricionesLu177 from './pages/RestricionesLu177'
import UniformidadGamma from './pages/UniformidadGamma'
import CorAnalysis from './pages/CorAnalysis'
import RTPlanCompare from './pages/RTPlanCompare'
import Tg43Calculator from './pages/Tg43Calculator'
import AcrQcPage from './pages/AcrQcPage'
import LectorRapido from './pages/LectorRapido'
import InformeTanques from './pages/InformeTanques'
import PetNemaFractionation from './pages/PetNemaFractionation'
import PetNemaAnalysis from './pages/PetNemaAnalysis'
import RtAnonymizer from './pages/RtAnonymizer'
import QCodes from './pages/QCodes'
import MorseTrainer from './pages/MorseTrainer'
import RadioExam from './pages/RadioExam'
import FdtdSimulator from './pages/FdtdSimulator'
import Admin from './pages/Admin'
import QuizCreator from './pages/QuizCreator'
import QuizList from './pages/QuizList'
import QuizHost from './pages/QuizHost'
import QuizJoin from './pages/QuizJoin'
import PasteCreate from './pages/PasteCreate'
import PasteView from './pages/PasteView'
import ExamAdminList from './pages/ExamAdminList'
import ExamHost from './pages/ExamHost'
import ExamPrintTickets from './pages/ExamPrintTickets'
import ExamJoin from './pages/ExamJoin'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Blog />} />
        <Route path="convert-units" element={<ConvertUnits />} />
        <Route path="decay-calculator" element={<DecayCalculator />} />
        <Route path="restricciones-lu177" element={<RestricionesLu177 />} />
        <Route path="uniformidad-gamma" element={<UniformidadGamma />} />
        <Route path="centro-rotacion-spect" element={<CorAnalysis />} />
        <Route path="rtplan-compare" element={<RTPlanCompare />} />
        <Route path="tg43-calculator" element={<Tg43Calculator />} />
        <Route path="acr-qc" element={<AcrQcPage />} />
        <Route path="lector" element={<LectorRapido />} />
        <Route path="informe-tanques" element={<InformeTanques />} />
        <Route path="pet-nema-fraccionamiento" element={<PetNemaFractionation />} />
        <Route path="pet-nema-analisis" element={<PetNemaAnalysis />} />
        <Route path="rt-anonymizer" element={<RtAnonymizer />} />
        <Route path="q-codes" element={<QCodes />} />
        <Route path="morse" element={<MorseTrainer />} />
        <Route path="radioaficionado" element={<RadioExam />} />
        <Route path="fdtd-simulator" element={<FdtdSimulator />} />
      </Route>
      <Route path="/admin" element={<Admin />} />
      <Route path="/quiz-creator" element={<QuizCreator />} />
      <Route path="/quizzes" element={<QuizList />} />
      <Route path="/host/:quizId" element={<QuizHost />} />
      <Route path="/join" element={<QuizJoin />} />
      <Route path="/ptb" element={<PasteCreate />} />
      <Route path="/ptb/:pasteId" element={<PasteView />} />
      <Route path="/exam-admin" element={<ExamAdminList />} />
      <Route path="/exam-admin/:sessionId" element={<ExamHost />} />
      <Route path="/exam-admin/:sessionId/print" element={<ExamPrintTickets />} />
      <Route path="/exam/join/:sessionId/:ticketSecret" element={<ExamJoin />} />
    </Routes>
  )
}

export default App
