import { render } from 'preact';
import { App } from './components/App';
import { boot } from './state';

render(<App />, document.getElementById('app')!);
boot();
