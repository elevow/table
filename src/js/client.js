import React from 'react';
import ReactDOM from 'react-dom';
import { Router, Route, browserHistory, IndexRoute } from 'react-router';

import Archives from "./pages/archives";
import Featured from "./pages/featured";
import Home from './pages/home'
import Layout from "./pages/layout";
import Settings from "./pages/settings";

const app = document.getElementById('app');

export default class Client extends React.Component {
        render(){
            return(
            <Router history={browserHistory}>
                <Route path='/' component={Layout}>
                <IndexRoute component={Home}/>
                <Route path='/settings' component={Settings}></Route>
                </Route>
            </Router>
            );
        }
}

ReactDOM.render(<Client />, app);