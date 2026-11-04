type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeLists(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyListsChanged(): void {
  listeners.forEach((listener) => listener());
}
