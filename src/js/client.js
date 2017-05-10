import React from 'react';
import ReactDOM from 'react-dom';
import { Router, Route, IndexRoute } from 'react-router';
import { createBrowserHistory } from 'history';

import Archives from "./pages/archives";
import Featured from "./pages/featured";
import Home from './pages/home'
import Layout from "./pages/layout";
import Settings from "./pages/settings";

const app = document.getElementById('app');

export default class Client extends React.Component {
        render(){
            return(
            <Router history={createBrowserHistory()}>
                <div>
                <Route path='/' component={Layout}></Route>
                <Route path='/settings' component={Settings}></Route>
                </div>
            </Router>
            );
        }
}

ReactDOM.render(<Client />, app);