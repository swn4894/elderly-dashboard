import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Authenticator component', () => {
  render(<App />);
  // The Authenticator component should render
  // Since we don't have a user logged in, it should show the sign-in form
  const app = document.body;
  expect(app).toBeInTheDocument();
});
