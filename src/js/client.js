import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router, Link, Route, Switch } from 'react-router-dom';
import { createBrowserHistory } from 'history';

import Archives from "./pages/archives";
import Layout from "./pages/layout";
import Settings from "./pages/settings";

const app = document.getElementById('app');

export default class Client extends React.Component {
        render(){
            return(
            <Router history={createBrowserHistory()}>
                <Switch>
            <Route exact={true} path='/' render={() => (
            <Layout />
            )}/>
            <Route path='/archives' component={Archives}/>
            <Route path='/settings' component={Settings}/>
            </Switch>
            </Router>
            );
        }
}

ReactDOM.render(<Client />, app);