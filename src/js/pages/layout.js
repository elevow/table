import React from 'react';


import Body from '../components/body';
import Footer from '../components/footer';
import Header from '../components/header';

export default class Layout extends React.Component {
    render() {
        return (
            <div>
                <Header />
                <Body />
                <Footer/>
                {this.props.children}
            </div>
        );
    }
}