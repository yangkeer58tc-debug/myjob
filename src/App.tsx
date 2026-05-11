import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import Home from "./pages/Home";
import JobList from "./pages/JobList";
import JobDetail from "./pages/JobDetail";
import SeoJobLanding from "./pages/SeoJobLanding";
import Admin from "./pages/Admin";
import ResumeAdminLayout from "./pages/resume-admin/ResumeAdminLayout";
import ResumesPage from "./pages/resume-admin/ResumesPage";
import ResumeImportPage from "./pages/resume-admin/ImportPage";
import ResumeDetailPage from "./pages/resume-admin/ResumeDetailPage";
import NotFound from "./pages/NotFound";
import CandidateSearch from "./pages/CandidateSearch";
import { EmpleosPrefixJobRedirect, EmployToEmpleoRedirect } from "./components/SeoCanonicalRedirects";
import StagingBanner from "./components/StagingBanner";

const queryClient = new QueryClient();

/** 单数 /admin/resume → /admin/resumes，避免手误或旧链接 404 */
const AdminResumeSingularToPlural = () => {
  const { id } = useParams();
  return <Navigate to={`/admin/resumes/${id ?? ""}`} replace />;
};

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <ErrorBoundary>
            <BrowserRouter>
              <StagingBanner />
              <AnalyticsTracker />
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/empleos" element={<JobList />} />
                <Route path="/empleos/:jobSlug" element={<EmpleosPrefixJobRedirect />} />
                <Route path="/empleos-en/:citySlug" element={<SeoJobLanding />} />
                <Route path="/empleos-en/:citySlug/:roleSlug" element={<SeoJobLanding />} />
                <Route path="/employ/:id/*" element={<EmployToEmpleoRedirect />} />
                <Route path="/empleo/:id" element={<JobDetail />} />
                <Route path="/buscar-candidatos" element={<CandidateSearch />} />
                <Route path="/buscar-candidatos/:role" element={<CandidateSearch />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/resume/import" element={<Navigate to="/admin/resumes/import" replace />} />
                <Route path="/admin/resume/:id" element={<AdminResumeSingularToPlural />} />
                <Route path="/admin/resume" element={<Navigate to="/admin/resumes" replace />} />
                <Route path="/admin/resumes" element={<ResumeAdminLayout />}>
                  <Route index element={<ResumesPage />} />
                  <Route path="import" element={<ResumeImportPage />} />
                  <Route path=":id" element={<ResumeDetailPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
