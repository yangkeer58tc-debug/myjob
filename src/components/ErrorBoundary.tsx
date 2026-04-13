import React from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {}

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center p-6">
        <div className="bg-card rounded-2xl shadow-lg p-6 w-full max-w-lg space-y-4">
          <div className="text-lg font-bold text-foreground">Algo salió mal</div>
          <div className="text-sm text-muted-foreground break-words">
            {this.state.error.message || 'Error desconocido'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-xl" onClick={() => window.location.reload()}>
              Recargar página
            </Button>
            <Button
              className="rounded-xl"
              variant="outline"
              onClick={() => {
                this.setState({ error: null });
                window.location.href = '/';
              }}
            >
              Ir al inicio
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
