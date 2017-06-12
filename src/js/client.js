import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import { createBrowserHistory } from 'history';

import About from './pages/about';
import Homepage from './pages/homepage';
import Settings from './pages/settings';
import Setup from './pages/setup';

const app = document.getElementById('app');

export default class Client extends React.Component {
  render() {
    return (
      <Router history={createBrowserHistory()}>
        <Switch>
          <Route exact={true}
            path='/'
            render={() => (
              <Homepage />
            )}
          />
          <Route path='/about' component={About} />
          <Route path='/settings' component={Settings} />
          <Route path='/setup' component={Setup} />
        </Switch>
      </Router>
    );
  }
}

ReactDOM.render(<Client />, app);
