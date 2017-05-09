import React from 'react';
import ReactDOM from 'react-dom';
import { Router, Route, browserHistory, IndexRoute } from 'react-router';

import Archives from "./pages/archives";
import Featured from "./pages/featured";
import Home from './pages/home'
import Layout from "./pages/layout";
import Settings from "./pages/settings";

const app = document.getElementById('app');

export default class App extends React.Component {
        render(){
            return(
            <Router history={browserHistory}>
                <IndexRoute component={Home}/>
                <Route path='/' component={Layout}></Route>
                <Route path='/settings' component={Settings}></Route>
            </Router>
            );
        }
}

ReactDOM.render(<App />, app);