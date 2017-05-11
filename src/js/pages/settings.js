import React from 'react';
import Footer from '../components/footer';
import Header from '../components/header';

export default class Settings extends React.Component {
    render() {
        return (
            <div>
            <Header/>
            <h1>Settings</h1>
            <Footer/>
            </div>
        );
    }
}