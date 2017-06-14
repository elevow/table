import React from 'react';


import Home from '../components/home';
import Footer from '../components/footer';
import Header from '../components/header';

export default class Homepage extends React.Component {
    render() {
        return (
            <div>
                <Header />
                <Home />
                <Footer/>
                {this.props.children}
            </div>
        );
    }
}